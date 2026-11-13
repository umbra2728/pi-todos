import io
import sys
import tokenize
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SKIPPED_DIRS = {"node_modules", ".git", "__pycache__"}


def python_comment_lines(source: str) -> list[int]:
    tokens = tokenize.generate_tokens(io.StringIO(source).readline)
    return [token.start[0] for token in tokens if token.type == tokenize.COMMENT]


def typescript_comment_lines(source: str) -> list[int]:
    lines: list[int] = []
    line = 1
    index = 0
    quote: str | None = None
    template_depth: list[int] = []
    brace_depth = 0
    length = len(source)
    while index < length:
        char = source[index]
        following = source[index + 1] if index + 1 < length else ""
        if char == "\n":
            line += 1
        if quote:
            if char == "\\":
                if following == "\n":
                    line += 1
                index += 2
                continue
            if quote == "`" and char == "$" and following == "{":
                template_depth.append(brace_depth)
                brace_depth += 1
                quote = None
                index += 2
                continue
            if char == quote:
                quote = None
            index += 1
            continue
        if char == "/" and following == "/":
            lines.append(line)
            while index < length and source[index] != "\n":
                index += 1
            continue
        if char == "/" and following == "*":
            lines.append(line)
            end = source.find("*/", index + 2)
            end = length if end == -1 else end + 2
            line += source.count("\n", index, end)
            index = end
            continue
        if char in "'\"`":
            quote = char
        elif char == "{":
            brace_depth += 1
        elif char == "}":
            brace_depth -= 1
            if template_depth and brace_depth == template_depth[-1]:
                template_depth.pop()
                quote = "`"
        index += 1
    return lines


CHECKERS = {".py": python_comment_lines, ".ts": typescript_comment_lines}


def source_files() -> list[Path]:
    return [
        path
        for path in ROOT.rglob("*")
        if path.suffix in CHECKERS and path.is_file() and not SKIPPED_DIRS.intersection(path.parts)
    ]


def main() -> int:
    violations = []
    for path in source_files():
        source = path.read_text(encoding="utf-8")
        start = 1 if source.startswith("#!") else 0
        for line in CHECKERS[path.suffix](source):
            if line > start:
                violations.append(f"{path.relative_to(ROOT)}:{line}: comments are not allowed")
    print("\n".join(violations) if violations else "no comments found")
    return 1 if violations else 0


if __name__ == "__main__":
    sys.exit(main())
