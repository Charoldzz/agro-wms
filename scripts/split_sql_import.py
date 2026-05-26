import argparse
from pathlib import Path


def split_sql(sql_text, max_bytes):
    statements = []
    current = []
    in_single_quote = False
    index = 0

    while index < len(sql_text):
        char = sql_text[index]
        current.append(char)

        if char == "'":
            next_char = sql_text[index + 1] if index + 1 < len(sql_text) else ""
            if in_single_quote and next_char == "'":
                current.append(next_char)
                index += 1
            else:
                in_single_quote = not in_single_quote
        elif char == ";" and not in_single_quote:
            statement = "".join(current).strip()
            if statement:
                statements.append(statement)
            current = []

        index += 1

    tail = "".join(current).strip()
    if tail:
        statements.append(tail)

    chunks = []
    current_chunk = []
    current_size = 0

    for statement in statements:
        normalized = "\n".join(
            line for line in statement.strip().splitlines()
            if not line.strip().startswith("--")
        ).strip().lower().rstrip(";")
        if normalized in {"begin", "commit"}:
            continue

        statement_text = statement + "\n\n"
        statement_size = len(statement_text.encode("utf-8"))

        if current_chunk and current_size + statement_size > max_bytes:
            chunks.append("".join(current_chunk).strip() + "\n")
            current_chunk = []
            current_size = 0

        current_chunk.append(statement_text)
        current_size += statement_size

    if current_chunk:
        chunks.append("".join(current_chunk).strip() + "\n")

    return chunks


def main():
    parser = argparse.ArgumentParser(description="Divide un SQL grande en partes pequeñas para Supabase SQL Editor.")
    parser.add_argument("input", help="Archivo SQL grande.")
    parser.add_argument("--output-dir", required=True, help="Carpeta donde guardar las partes.")
    parser.add_argument("--max-mb", type=float, default=1.5, help="Tamaño máximo aproximado por parte.")
    args = parser.parse_args()

    input_path = Path(args.input)
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    for old_file in output_dir.glob("*.sql"):
      old_file.unlink()

    sql_text = input_path.read_text(encoding="utf-8")
    chunks = split_sql(sql_text, int(args.max_mb * 1024 * 1024))

    for position, chunk in enumerate(chunks, start=1):
        output_path = output_dir / f"solucion_mirror_import_part_{position:02d}.sql"
        output_path.write_text(chunk, encoding="utf-8")
        print(f"{output_path} | {len(chunk.encode('utf-8'))} bytes")

    print(f"Partes generadas: {len(chunks)}")


if __name__ == "__main__":
    main()
