"""Read-only basic DOCX view from original OOXML, independent of RAG blocks.

No scripts, external relationships, HTML, or filesystem extraction are permitted.
This flow view preserves runs, basic tables and raster pictures, not Word pagination.
"""
import base64
from pathlib import PurePosixPath
import posixpath
import re
import struct
from zipfile import ZipFile, BadZipFile

from .parsing import ParseError
from .parsing.docx import W, safe_xml, attr, MAX_ENTRIES, MAX_UNCOMPRESSED

R = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}'
A = '{http://schemas.openxmlformats.org/drawingml/2006/main}'
MAX_NODES = 20000
MAX_IMAGES = 10 * 1024 * 1024


def raster_type(data):
    """Accept bounded PNG/JPEG only, never active SVG or arbitrary data URLs."""
    if data.startswith(b'\x89PNG\r\n\x1a\n') and len(data) >= 24:
        width, height = struct.unpack('>II', data[16:24])
        return 'image/png' if 0 < width <= 10000 and 0 < height <= 10000 and width * height <= 16_000_000 else None
    if data.startswith(b'\xff\xd8'):
        offset = 2
        while offset + 4 < len(data):
            if data[offset] != 255:
                break
            marker = data[offset + 1]
            length = int.from_bytes(data[offset + 2:offset + 4], 'big')
            if length < 2:
                break
            if marker in (0xC0, 0xC1, 0xC2) and offset + 9 < len(data):
                height, width = struct.unpack('>HH', data[offset + 5:offset + 9])
                return 'image/jpeg' if 0 < width <= 10000 and 0 < height <= 10000 and width * height <= 16_000_000 else None
            offset += length + 2
    return None


def original_docx(path):
    nodes = 0
    text_size = 0
    image_size = 0
    warnings = set()
    try:
        with ZipFile(path) as archive:
            infos = archive.infolist()
            if len(infos) > MAX_ENTRIES or sum(info.file_size for info in infos) > MAX_UNCOMPRESSED:
                raise ParseError('FILE_TOO_LARGE')
            relationships = {}
            if 'word/_rels/document.xml.rels' in archive.namelist():
                for relation in safe_xml(archive.read('word/_rels/document.xml.rels')):
                    if relation.get('TargetMode') == 'External':
                        continue
                    raw_target = relation.get('Target', '')
                    target = posixpath.normpath(raw_target.lstrip('/') if raw_target.startswith('/word/') else 'word/' + raw_target)
                    if target.startswith('word/') and not PurePosixPath(target).is_absolute():
                        relationships[relation.get('Id')] = target
            styles = {}
            if 'word/styles.xml' in archive.namelist():
                for style in safe_xml(archive.read('word/styles.xml')).findall(W + 'style'):
                    styles[attr(style, 'styleId')] = attr(style.find(W + 'name'), 'val') or ''

            def image(blip):
                nonlocal image_size, nodes
                nodes += 1
                if nodes > MAX_NODES:
                    raise ParseError('OUTPUT_TOO_LARGE')
                target = relationships.get(blip.get(R + 'embed'), '')
                if not target.startswith('word/media/') or target not in archive.namelist():
                    warnings.add('部分图片或外部资源未加载')
                    return {'type':'placeholder', 'text':'[图片不可用]'}
                info = archive.getinfo(target)
                if info.file_size > 2 * 1024 * 1024 or image_size + info.file_size > MAX_IMAGES:
                    warnings.add('较大图片未加载')
                    return {'type':'placeholder', 'text':'[图片超过基础预览限制]'}
                data = archive.read(target)
                mime = raster_type(data)
                if not mime:
                    warnings.add('基础预览只显示 PNG/JPEG 图片')
                    return {'type':'placeholder', 'text':'[此图片格式需版式预览]'}
                image_size += len(data)
                return {'type':'image', 'src':f'data:{mime};base64,' + base64.b64encode(data).decode('ascii')}

            def convert(element, depth=0):
                nonlocal nodes, text_size
                nodes += 1
                if nodes > MAX_NODES or depth > 16:
                    raise ParseError('OUTPUT_TOO_LARGE')
                kind = element.tag.removeprefix(W)
                if kind == 'p':
                    properties = element.find(W + 'pPr')
                    style_id = attr(properties.find(W + 'pStyle'), 'val') if properties is not None else ''
                    style_name = styles.get(style_id, style_id or '')
                    heading = re.match(r'(?:heading|标题)\s*([1-9])', style_name, re.I)
                    alignment = attr(properties.find(W + 'jc'), 'val') if properties is not None else None
                    numbered = properties is not None and properties.find(W + 'numPr') is not None
                    return {'type':'paragraph', 'heading':min(int(heading.group(1)),6) if heading else None,
                            'align':alignment if alignment in ('left','right','center','both') else 'left',
                            'list':numbered, 'children':[convert(run,depth+1) for run in element.iter(W+'r')]}
                if kind == 'r':
                    properties = element.find(W + 'rPr')
                    def flag(name):
                        value = properties.find(W+name) if properties is not None else None
                        return value is not None and attr(value,'val') not in ('false','0','off')
                    parts = []
                    for child in element:
                        if child.tag == W+'t':
                            text = child.text or ''
                            text_size += len(text)
                            if text_size > 2_000_000:
                                raise ParseError('OUTPUT_TOO_LARGE')
                            parts.append({'type':'text','text':text})
                        elif child.tag in (W+'br',W+'cr'):
                            parts.append({'type':'text','text':'\n'})
                        elif child.tag == W+'tab':
                            parts.append({'type':'text','text':'\t'})
                        else:
                            parts.extend(image(blip) for blip in child.iter(A+'blip'))
                    return {'type':'run','bold':flag('b'),'italic':flag('i'),'underline':flag('u'),'children':parts}
                if kind == 'tbl':
                    rows = []
                    for row in element.findall(W+'tr'):
                        nodes += 1
                        if nodes > MAX_NODES:
                            raise ParseError('OUTPUT_TOO_LARGE')
                        cells = []
                        for cell in row.findall(W+'tc'):
                            nodes += 1
                            if nodes > MAX_NODES:
                                raise ParseError('OUTPUT_TOO_LARGE')
                            span = attr(cell.find(W+'tcPr/'+W+'gridSpan'),'val')
                            cells.append({'type':'cell','colspan':max(1,min(50,int(span))) if span and span.isdigit() else 1,
                                          'children':[convert(item,depth+1) for item in cell if item.tag in (W+'p',W+'tbl')]})
                        rows.append({'type':'row','children':cells})
                    return {'type':'table','children':rows}
                return {'type':'group','children':[convert(item,depth+1) for item in element if item.tag in (W+'p',W+'tbl')]}

            document = safe_xml(archive.read('word/document.xml'))
            body = document.find(W+'body')
            if body is None:
                raise ParseError('INVALID_FILE')
            return {'kind':'docx','content':convert(body),'warnings':sorted(warnings),
                    'notice':'原件基础预览（只读）：显示正文、基本样式、表格和常见图片；页眉页脚、脚注与复杂分页请使用可选版式预览或系统应用。'}
    except (BadZipFile, KeyError):
        raise ParseError('INVALID_FILE') from None
