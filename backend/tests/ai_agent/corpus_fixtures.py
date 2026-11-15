"""Synthetic test document corpus covering realistic medical document conditions."""

import io
from PIL import Image
import pymupdf


def make_simple_text_pdf() -> bytes:
    """1. Simple single-page text PDF."""
    doc = pymupdf.open()
    p = doc.new_page()
    p.insert_text(
        (72, 72),
        "OUTPATIENT CLINICAL SUMMARY\n"
        "Patient: Alice Walker | Age: 42 | Gender: Female\n"
        "Chief Complaint: Persistent seasonal allergies.\n"
        "Assessment: Allergic rhinitis.\n"
        "Plan: Cetirizine 10mg daily as needed.\n",
        fontsize=11,
    )
    return doc.tobytes()


def make_multipage_text_pdf(pages: int = 3) -> bytes:
    """2. Multi-page narrative clinical notes."""
    doc = pymupdf.open()
    for i in range(pages):
        p = doc.new_page()
        p.insert_text(
            (72, 72),
            f"INPATIENT PROGRESS NOTE - HOSPITAL DAY {i + 1}\n"
            f"Subjective: Patient reports improved breathing and appetite on day {i + 1}.\n"
            f"Objective: Blood Pressure 122/78 mmHg, Heart Rate 74 bpm, SpO2 99% on room air.\n"
            f"Assessment: Stable clinical improvement.\n"
            f"Plan: Continue current oral medications and monitor telemetry.\n",
            fontsize=11,
        )
    return doc.tobytes()


def make_lab_report_pdf() -> bytes:
    """3. Structured lab report with test names, values, units, and ranges."""
    doc = pymupdf.open()
    p = doc.new_page()
    p.insert_text(
        (72, 72),
        "COMPREHENSIVE METABOLIC PANEL\n"
        "Analyte             Result    Units     Reference Interval\n"
        "Serum Glucose       94        mg/dL     70 - 99\n"
        "Blood Urea Nitrogen 15        mg/dL     7 - 20\n"
        "Serum Creatinine    0.92      mg/dL     0.60 - 1.20\n"
        "Serum Sodium        139       mmol/L    136 - 145\n"
        "Serum Potassium     4.1       mmol/L    3.5 - 5.1\n"
        "Serum Chloride      102       mmol/L    98 - 107\n",
        fontsize=10,
    )
    return doc.tobytes()


def make_multipage_table_pdf() -> bytes:
    """4. Multi-page medication administration table."""
    doc = pymupdf.open()
    p1 = doc.new_page()
    p1.insert_text(
        (72, 72),
        "MEDICATION SCHEDULE - PART 1\n"
        "Medication      Dose    Route   Frequency\n"
        "Metformin       500mg   Oral    Twice daily\n"
        "Lisinopril      10mg    Oral    Once daily\n",
        fontsize=10,
    )
    p2 = doc.new_page()
    p2.insert_text(
        (72, 72),
        "MEDICATION SCHEDULE - PART 2\n"
        "Medication      Dose    Route   Frequency\n"
        "Atorvastatin    20mg    Oral    At bedtime\n"
        "Aspirin         81mg    Oral    Once daily\n",
        fontsize=10,
    )
    return doc.tobytes()


def make_image_pdf() -> bytes:
    """5. Document containing an embedded clinical image/scan."""
    doc = pymupdf.open()
    p = doc.new_page()
    p.insert_text((72, 50), "DERMATOLOGY CONSULTATION PHOTO\nFinding: Benign seborrheic keratosis.")
    img = Image.new("RGB", (120, 120), color=(200, 150, 150))
    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    p.insert_image(pymupdf.Rect(72, 100, 220, 220), stream=buf.getvalue())
    return doc.tobytes()


def make_scanned_ocr_pdf() -> bytes:
    """6. Scanned image-only PDF page without digital text layer."""
    src = pymupdf.open()
    sp = src.new_page(width=700, height=220)
    sp.insert_text(
        (40, 90),
        "SCANNED PATHOLOGY: Benign lymph node tissue.",
        fontsize=24,
    )
    pix = sp.get_pixmap(dpi=200)
    doc = pymupdf.open()
    p = doc.new_page(width=700, height=220)
    p.insert_image(pymupdf.Rect(0, 0, 700, 220), stream=pix.tobytes("png"))
    return doc.tobytes()


def make_line_chart_pdf() -> bytes:
    """7b. Clinical document with a geometric line chart."""
    doc = pymupdf.open()
    p = doc.new_page()
    p.insert_text((72, 50), "HB1AC TREND LINE CHART")
    points = [(80, 180), (140, 150), (200, 130), (260, 110)]
    for i in range(len(points) - 1):
        p.draw_line(points[i], points[i + 1], color=(0, 0.4, 0.8), width=2)
    p.insert_text((72, 210), "HbA1c trend: Q1=7.4%, Q2=6.9%, Q3=6.5%, Q4=6.2%.")
    return doc.tobytes()


def make_pie_chart_pdf() -> bytes:
    """7c. Clinical document with a geometric pie chart."""
    doc = pymupdf.open()
    p = doc.new_page()
    p.insert_text((72, 50), "CALORIC MACRONUTRIENT PIE CHART")
    p.draw_circle((160, 135), 45, color=(0.2, 0.5, 0.2), fill=(0.8, 0.95, 0.8))
    p.draw_line((160, 135), (205, 135), color=(0, 0, 0))
    p.draw_line((160, 135), (160, 90), color=(0, 0, 0))
    p.insert_text((72, 210), "Distribution: Carbs 50%, Protein 25%, Fat 25%.")
    return doc.tobytes()


def make_chart_pdf() -> bytes:
    """7. Clinical document with geometric bar charts."""
    doc = pymupdf.open()
    p = doc.new_page()
    p.insert_text((72, 50), "BLOOD PRESSURE MONITORING LOG")
    p.draw_rect(pymupdf.Rect(72, 80, 100, 180), color=(0, 0, 1), fill=(0, 0, 1))
    p.draw_rect(pymupdf.Rect(110, 90, 138, 180), color=(0, 0, 1), fill=(0, 0, 1))
    p.draw_rect(pymupdf.Rect(148, 75, 176, 180), color=(0, 0, 1), fill=(0, 0, 1))
    p.insert_text((72, 210), "Morning SBP: Day 1=135, Day 2=128, Day 3=122 mmHg.")
    return doc.tobytes()


def make_diagram_pdf() -> bytes:
    """8. Clinical diagnostic pathway diagram."""
    doc = pymupdf.open()
    p = doc.new_page()
    p.insert_text((72, 50), "DIAGNOSTIC PATHWAY: CHEST PAIN TRIAGE")
    p.draw_rect(pymupdf.Rect(72, 80, 220, 120), color=(0, 0, 0))
    p.insert_text((80, 100), "Initial ECG and Troponin")
    p.draw_line((146, 120), (146, 160), color=(0, 0, 0))
    p.draw_rect(pymupdf.Rect(72, 160, 220, 200), color=(0, 0, 0))
    p.insert_text((80, 180), "Negative: Consider stress echo")
    return doc.tobytes()


def make_text_and_tables_pdf() -> bytes:
    """9. Document combining narrative clinical history and a structured table."""
    doc = pymupdf.open()
    p = doc.new_page()
    p.insert_text(
        (72, 72),
        "DISCHARGE SUMMARY\n"
        "Patient was admitted with acute gastroenteritis and managed with IV fluids.\n"
        "Symptoms fully resolved by discharge date.\n\n"
        "DISCHARGE MEDICATIONS:\n"
        "Drug        Strength   Sig\n"
        "Oral rehydration  Packets    Ad libitum\n"
        "Ondansetron 4mg        Q8H PRN nausea\n",
        fontsize=10,
    )
    return doc.tobytes()


def make_partially_unreadable_pdf() -> bytes:
    """10. Partially unreadable or low-quality document."""
    doc = pymupdf.open()
    p1 = doc.new_page()
    p1.insert_text((72, 72), "PARTIAL RECORD: Page 1 valid medical notes.")
    p2 = doc.new_page()
    # Noisy / artifact stream
    p2.insert_text((72, 72), "~~~###@@@ Low quality scan artifact @@@###~~~")
    return doc.tobytes()


def make_encrypted_pdf() -> bytes:
    """11. Password-encrypted PDF rejected during upload validation."""
    doc = pymupdf.open()
    p = doc.new_page()
    p.insert_text((72, 72), "Encrypted medical chart.")
    return doc.tobytes(encryption=pymupdf.PDF_ENCRYPT_AES_256, user_pw="secret123")


def make_large_pdf(page_count: int = 45) -> bytes:
    """12. Multi-page document near published limit processed in bounded batches."""
    doc = pymupdf.open()
    for i in range(page_count):
        p = doc.new_page()
        p.insert_text(
            (72, 72),
            f"MULTI-YEAR LONGITUDINAL RECORD - VOLUME {i + 1}\n"
            f"Observation date: 202{i % 5}-0{(i % 9) + 1}-15\n"
            f"Clinical status: Patient stable, routine follow-up note for period {i + 1}.\n",
            fontsize=10,
        )
    return doc.tobytes()
