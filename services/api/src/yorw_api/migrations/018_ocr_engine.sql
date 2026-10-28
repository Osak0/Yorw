-- v0.3.0 stage 1 step 5 follow-up: selectable OCR engine for user-installed
-- Docling extras. Auto keeps Docling's own preference; rapidocr avoids the
-- GitHub-hosted EasyOCR model download on restricted networks.
ALTER TABLE parser_settings ADD COLUMN ocr_engine TEXT NOT NULL DEFAULT 'auto';
