-- v0.3.0 stage 1 step 5: user-selected parser configuration.
-- Components are never bundled; paths are user-provided and detection is explicit.
CREATE TABLE parser_settings (
    singleton INTEGER PRIMARY KEY CHECK(singleton=1),
    enhanced_enabled INTEGER NOT NULL DEFAULT 0 CHECK(enhanced_enabled IN (0,1)),
    docling_executable TEXT NOT NULL DEFAULT '',
    docling_prefix_json TEXT NOT NULL DEFAULT '[]',
    libreoffice_executable TEXT NOT NULL DEFAULT '',
    timeout_seconds REAL NOT NULL DEFAULT 600,
    ocr_enabled INTEGER NOT NULL DEFAULT 1 CHECK(ocr_enabled IN (0,1)),
    ocr_mode TEXT NOT NULL DEFAULT 'default',
    version INTEGER NOT NULL DEFAULT 1
);
INSERT INTO parser_settings(singleton) VALUES(1);
