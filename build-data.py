#!/usr/bin/env python3
import argparse
import json
import re
import sys
import zipfile
from pathlib import Path
from urllib.parse import unquote
from xml.etree import ElementTree as ET


NAMESPACES = {
    "main": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
    "rel": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "pkgrel": "http://schemas.openxmlformats.org/package/2006/relationships",
}

REQUIRED_COLUMNS = {
    "brand": "Brand",
    "model": "Model",
    "version": "Version",
    "score": "OVERALL SCORE (0-100)",
}

OPTIONAL_COLUMNS = {
    "photoUrl": "Photo URL",
    "country": "Country of Origin",
    "launchYear": "Launch Year",
    "propulsion": "Propulsion Type",
    "unitsProduced": "Units Produced",
    "priceUsd": "Estimated Price (USD)",
    "powerHp": "Max Power (hp)",
    "topSpeedKmh": "Top Speed (km/h)",
    "torqueNm": "Torque (Nm)",
    "scoreRarity": "Score_Rarity (25%)",
    "scorePower": "Score_Power (20%)",
    "scoreSpeed": "Score_Speed (20%)",
    "scoreTorque": "Score_Torque (15%)",
    "scoreValue": "Score_Value (20%)",
    "overallScore": "OVERALL SCORE (0-100)",
}


def main():
    parser = argparse.ArgumentParser(
        description="Converte a planilha de hipercarros em hypercars-data.js."
    )
    parser.add_argument("xlsx", help="Caminho do arquivo .xlsx atualizado.")
    parser.add_argument(
        "--out",
        default="outputs/hypercar-duel/hypercars-data.js",
        help="Arquivo de saída usado pelo app.",
    )
    parser.add_argument(
        "--sheet",
        default=None,
        help="Nome da aba. Se omitido, usa a primeira aba da planilha.",
    )
    args = parser.parse_args()

    xlsx_path = Path(args.xlsx)
    output_path = Path(args.out)

    if not xlsx_path.exists():
        raise SystemExit(f"Arquivo não encontrado: {xlsx_path}")

    rows = read_xlsx_rows(xlsx_path, args.sheet)
    cars = normalize_rows(rows)

    if len(cars) < 2:
        raise SystemExit("A planilha precisa ter pelo menos duas opções válidas.")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    payload = (
        "window.HYPERCARS = "
        + json.dumps(cars, ensure_ascii=False, indent=2)
        + ";\n"
        + "window.HYPERCARS_META = "
        + json.dumps(
            {
                "sourceFile": xlsx_path.name,
                "totalOptions": len(cars),
                "maxOverallScore": max(
                    (car["overallScore"] for car in cars if car["overallScore"] is not None),
                    default=None,
                ),
            },
            ensure_ascii=False,
            indent=2,
        )
        + ";\n"
    )
    output_path.write_text(payload, encoding="utf-8")

    with_photo = sum(1 for car in cars if car.get("photoUrl"))
    print(f"Base atualizada: {output_path}")
    print(f"Opções geradas: {len(cars)}")
    print(f"Opções com Photo URL: {with_photo}")


def read_xlsx_rows(path, sheet_name=None):
    with zipfile.ZipFile(path) as archive:
        workbook_xml = read_xml(archive, "xl/workbook.xml")
        workbook_rels = read_xml(archive, "xl/_rels/workbook.xml.rels")
        sheet_path = resolve_sheet_path(workbook_xml, workbook_rels, sheet_name)
        shared_strings = read_shared_strings(archive)
        hyperlinks = read_sheet_hyperlinks(archive, sheet_path)
        sheet_xml = read_xml(archive, sheet_path)
        matrix = read_sheet_matrix(sheet_xml, shared_strings, hyperlinks)

    header_index = find_header_row(matrix)
    headers = [clean_text(value) for value in matrix[header_index]]
    rows = []

    for row in matrix[header_index + 1 :]:
        record = {}
        for index, header in enumerate(headers):
            if header:
                record[header] = row[index] if index < len(row) else ""
        rows.append(record)

    return rows


def read_xml(archive, path):
    try:
        return ET.fromstring(archive.read(path))
    except KeyError as exc:
        raise SystemExit(f"Arquivo interno ausente no Excel: {path}") from exc


def resolve_sheet_path(workbook_xml, workbook_rels, sheet_name):
    sheets = workbook_xml.find("main:sheets", NAMESPACES)
    if sheets is None:
        raise SystemExit("Não encontrei abas na planilha.")

    sheet = None
    for candidate in sheets.findall("main:sheet", NAMESPACES):
        if sheet_name is None or candidate.attrib.get("name") == sheet_name:
            sheet = candidate
            break

    if sheet is None:
        raise SystemExit(f"Aba não encontrada: {sheet_name}")

    rel_id = sheet.attrib.get(f"{{{NAMESPACES['rel']}}}id")
    rels = {
        rel.attrib.get("Id"): rel.attrib.get("Target")
        for rel in workbook_rels.findall("pkgrel:Relationship", NAMESPACES)
    }
    target = rels.get(rel_id)
    if not target:
        raise SystemExit("Não consegui resolver a aba principal da planilha.")

    target = target.replace("\\", "/")
    if target.startswith("/"):
        return target.lstrip("/")
    if target.startswith("xl/"):
        return target
    return f"xl/{target}"


def read_shared_strings(archive):
    if "xl/sharedStrings.xml" not in archive.namelist():
        return []

    xml = read_xml(archive, "xl/sharedStrings.xml")
    values = []
    for item in xml.findall("main:si", NAMESPACES):
        text = "".join(node.text or "" for node in item.findall(".//main:t", NAMESPACES))
        values.append(text)
    return values


def read_sheet_hyperlinks(archive, sheet_path):
    rels_path = sheet_rels_path(sheet_path)
    if rels_path not in archive.namelist():
        return {}

    rels_xml = read_xml(archive, rels_path)
    targets = {
        rel.attrib.get("Id"): rel.attrib.get("Target")
        for rel in rels_xml.findall("pkgrel:Relationship", NAMESPACES)
    }

    sheet_xml = read_xml(archive, sheet_path)
    links = {}
    for link in sheet_xml.findall(".//main:hyperlink", NAMESPACES):
        ref = link.attrib.get("ref")
        rel_id = link.attrib.get(f"{{{NAMESPACES['rel']}}}id")
        if ref and rel_id and targets.get(rel_id):
            links[ref] = targets[rel_id]
    return links


def sheet_rels_path(sheet_path):
    folder = Path(sheet_path).parent.as_posix()
    name = Path(sheet_path).name
    return f"{folder}/_rels/{name}.rels"


def read_sheet_matrix(sheet_xml, shared_strings, hyperlinks):
    rows = []
    sheet_data = sheet_xml.find("main:sheetData", NAMESPACES)
    if sheet_data is None:
        return rows

    for row in sheet_data.findall("main:row", NAMESPACES):
        values = []
        for cell in row.findall("main:c", NAMESPACES):
            ref = cell.attrib.get("r", "")
            column_index = column_name_to_index(re.sub(r"\d", "", ref))
            while len(values) <= column_index:
                values.append("")
            values[column_index] = read_cell_value(cell, shared_strings, hyperlinks.get(ref, ""))
        rows.append(values)
    return rows


def read_cell_value(cell, shared_strings, hyperlink):
    if hyperlink:
        return hyperlink

    formula = cell.find("main:f", NAMESPACES)
    if formula is not None and formula.text:
        parsed_link = parse_hyperlink_formula(formula.text)
        if parsed_link:
            return parsed_link

    cell_type = cell.attrib.get("t")
    value = cell.find("main:v", NAMESPACES)
    raw = value.text if value is not None and value.text is not None else ""

    if cell_type == "s":
        try:
            return shared_strings[int(raw)]
        except (ValueError, IndexError):
            return ""
    if cell_type == "inlineStr":
        return "".join(node.text or "" for node in cell.findall(".//main:t", NAMESPACES))
    return raw


def parse_hyperlink_formula(formula):
    match = re.match(r'^HYPERLINK\("([^"]+)"', formula, re.I)
    return match.group(1) if match else ""


def find_header_row(matrix):
    required = set(REQUIRED_COLUMNS.values())
    for index, row in enumerate(matrix):
        if required.issubset({clean_text(value) for value in row}):
            return index
    raise SystemExit(
        "Não encontrei as colunas obrigatórias: "
        + ", ".join(REQUIRED_COLUMNS.values())
    )


def normalize_rows(rows):
    cars = []
    seen = set()

    for index, row in enumerate(rows, start=1):
        car = {
            "id": f"car-{index}",
            "brand": clean_text(row.get("Brand")),
            "model": clean_text(row.get("Model")),
            "version": clean_text(row.get("Version")),
        }

        if not car["brand"] or not car["model"] or not car["version"]:
            continue

        identity = f"{car['brand']} | {car['model']} | {car['version']}".lower()
        if identity in seen:
            continue
        seen.add(identity)

        for target_key, source_column in OPTIONAL_COLUMNS.items():
            value = row.get(source_column, "")
            if target_key == "photoUrl":
                car[target_key] = normalize_photo_url(value)
            elif target_key in {"country", "propulsion"}:
                car[target_key] = clean_text(value)
            else:
                car[target_key] = to_number(value)

        cars.append(car)

    ranked = sorted(
        cars,
        key=lambda car: (
            -(car["overallScore"] if car["overallScore"] is not None else float("-inf")),
            car["brand"],
            car["model"],
            car["version"],
        ),
    )
    for position, car in enumerate(ranked, start=1):
        car["overallPosition"] = position

    return cars


def clean_text(value):
    if value is None:
        return ""
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value).strip()


def to_number(value):
    text = clean_text(value)
    if not text:
        return None
    try:
        number = float(text.replace(",", "."))
    except ValueError:
        return None
    return int(number) if number.is_integer() else number


def normalize_photo_url(value):
    url = clean_text(value)
    if not url:
        return ""

    url = unquote(url)
    if re.match(r"^www\.", url, re.I):
        url = f"https://{url}"
    if re.match(r"^[a-z]:\\", url, re.I):
        url = "file:///" + url.replace("\\", "/").replace(" ", "%20")

    google_file = re.search(r"drive\.google\.com/file/d/([^/]+)", url, re.I)
    if google_file:
        return f"https://drive.google.com/uc?export=view&id={google_file.group(1)}"

    google_open = re.search(r"[?&]id=([^&]+)", url, re.I)
    if "drive.google.com" in url.lower() and google_open:
        return f"https://drive.google.com/uc?export=view&id={google_open.group(1)}"

    if "dropbox.com" in url.lower():
        if "dl=0" in url:
            return re.sub(r"([?&])dl=0\b", r"\1dl=1", url)
        if "?" not in url:
            return f"{url}?dl=1"

    return url


def column_name_to_index(name):
    total = 0
    for char in name:
        total = total * 26 + ord(char.upper()) - 64
    return total - 1


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(130)
