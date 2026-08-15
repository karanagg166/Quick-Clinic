-- Doctors save a practice location once; patient locations are never stored.
CREATE EXTENSION IF NOT EXISTS postgis;

ALTER TABLE "Doctor"
  ADD COLUMN "latitude" DOUBLE PRECISION,
  ADD COLUMN "longitude" DOUBLE PRECISION,
  ADD COLUMN "practiceLocation" geography(Point, 4326)
    GENERATED ALWAYS AS (
      CASE
        WHEN "latitude" IS NOT NULL AND "longitude" IS NOT NULL
        THEN ST_SetSRID(ST_MakePoint("longitude", "latitude"), 4326)::geography
        ELSE NULL
      END
    ) STORED;

ALTER TABLE "Doctor"
  ADD CONSTRAINT "Doctor_practice_coordinates_valid"
  CHECK (
    ("latitude" IS NULL AND "longitude" IS NULL)
    OR (
      "latitude" BETWEEN -90 AND 90
      AND "longitude" BETWEEN -180 AND 180
    )
  );

CREATE INDEX "Doctor_practiceLocation_gist_idx"
  ON "Doctor" USING GIST ("practiceLocation");
