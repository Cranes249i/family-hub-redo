# 家庭事务中心 · 构建脚本
# 把四个实战项目的产出按相对路径读进来，拼成 data.js；split.js 原样复制过来。
# 本脚本不抓取、不计算分摊，只搬数据——分摊规则全部交给 split.js。

import json
import re
import shutil
import sys
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

BASE_DIR = Path(__file__).resolve().parent
PARENT_DIR = BASE_DIR.parent

READING_EVENTS = PARENT_DIR / "16-读书会网站" / "data" / "events.json"
SHOP_SUMMARY = PARENT_DIR / "17-订单月报" / "output" / "summary.json"
TRIP_DATA = PARENT_DIR / "18-费用分摊" / "data" / "trip.json"
TRIP_SPLIT_JS = PARENT_DIR / "18-费用分摊" / "split.js"
NOTICE_DIR = PARENT_DIR / "19-通知追踪" / "周报"

PLACEHOLDER_MARK = "留空"


def load_json(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def find_latest_report(notice_dir):
    reports = sorted(notice_dir.glob("*.md"), key=lambda p: p.stat().st_mtime, reverse=True)
    if not reports:
        raise FileNotFoundError(f"{notice_dir} 里没有找到周报 md 文件")
    return reports[0]


def extract_section(text, heading):
    pattern = rf"^##\s*{re.escape(heading)}\s*$(.*?)(?=^##\s|\Z)"
    m = re.search(pattern, text, flags=re.M | re.S)
    return m.group(1).strip() if m else ""


def parse_weekly_report(path):
    text = path.read_text(encoding="utf-8")
    lines = text.splitlines()

    title_line = next((l for l in lines if l.startswith("# ")), "")
    date_match = re.search(r"(\d{4}-\d{2}-\d{2})", title_line)
    date = date_match.group(1) if date_match else path.stem

    # 标题后、第一个 "## " 之前的那句概述（新增/基线提示）
    summary = ""
    for l in lines[1:]:
        if l.startswith("## "):
            break
        if l.strip():
            summary = l.strip()
            break

    log_section = extract_section(text, "抓取日志")
    log_lines = [l[2:].strip() for l in log_section.splitlines() if l.strip().startswith("- ")]

    related_section = extract_section(text, "本周与你有关的")
    related_to_you = None if (not related_section or PLACEHOLDER_MARK in related_section) else related_section

    new_count_match = re.search(r"新增\s*(\d+)\s*条", summary)
    total_count_match = re.search(r"共抓取\s*(\d+)\s*条", summary)

    return {
        "date": date,
        "summary": summary,
        "logLines": log_lines,
        "relatedToYou": related_to_you,
        "newCount": int(new_count_match.group(1)) if new_count_match else None,
        "totalCount": int(total_count_match.group(1)) if total_count_match else None,
        "sourceFile": path.name,
    }


def main():
    data = {
        "reading": load_json(READING_EVENTS),
        "shop": load_json(SHOP_SUMMARY),
        "trip": load_json(TRIP_DATA),
        "notice": parse_weekly_report(find_latest_report(NOTICE_DIR)),
    }

    data_js = "window.DATA = " + json.dumps(data, ensure_ascii=False, indent=2) + ";\n"
    (BASE_DIR / "data.js").write_text(data_js, encoding="utf-8")

    shutil.copyfile(TRIP_SPLIT_JS, BASE_DIR / "split.js")

    print(f"读书会：{len(data['reading'].get('events', []))} 场预告，{len(data['reading'].get('past', []))} 场历史")
    print(f"网店月报：{data['shop'].get('month')}，有效订单 {data['shop'].get('valid_orders')} 笔")
    print(f"旅行分摊：{data['trip'].get('name')}，{len(data['trip'].get('expenses', []))} 笔费用")
    print(f"政策周报：{data['notice']['date']}（来自 {data['notice']['sourceFile']}），"
          f"本周与你有关的：{'已填写' if data['notice']['relatedToYou'] else '待填写'}")
    print("已写入 data.js，已复制 split.js")


if __name__ == "__main__":
    main()
