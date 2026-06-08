import os
import struct
import zipfile
from datetime import datetime
from pathlib import Path
from xml.sax.saxutils import escape


OUT = Path("マンション名オートコンプリート_取扱説明書.docx")
IMAGES = [
    ("manual-01-candidate-popup.png", "候補リストの表示例"),
    ("manual-02-settings.png", "設定画面"),
    ("manual-03-site-disabled.png", "サイト別に無効化した状態"),
    ("manual-04-copy-success.png", "入力とコピーの成功表示"),
]

EMU_PER_INCH = 914400
PAGE_CONTENT_WIDTH_IN = 6.5


def png_size(path):
    with open(path, "rb") as f:
        sig = f.read(8)
        if sig != b"\x89PNG\r\n\x1a\n":
            raise ValueError(f"{path} is not a PNG")
        length = struct.unpack(">I", f.read(4))[0]
        chunk = f.read(4)
        if chunk != b"IHDR":
            raise ValueError(f"{path} missing IHDR")
        data = f.read(length)
        width, height = struct.unpack(">II", data[:8])
        return width, height


def p(text="", style=None, bold=False, color=None):
    ppr = f"<w:pPr><w:pStyle w:val=\"{style}\"/></w:pPr>" if style else ""
    rpr_parts = []
    if bold:
        rpr_parts.append("<w:b/>")
    if color:
        rpr_parts.append(f"<w:color w:val=\"{color}\"/>")
    rpr = f"<w:rPr>{''.join(rpr_parts)}</w:rPr>" if rpr_parts else ""
    return f"<w:p>{ppr}<w:r>{rpr}<w:t xml:space=\"preserve\">{escape(text)}</w:t></w:r></w:p>"


def bullet(text):
    return (
        "<w:p><w:pPr><w:pStyle w:val=\"ListParagraph\"/>"
        "<w:numPr><w:ilvl w:val=\"0\"/><w:numId w:val=\"1\"/></w:numPr></w:pPr>"
        f"<w:r><w:t xml:space=\"preserve\">{escape(text)}</w:t></w:r></w:p>"
    )


def numbered(text):
    return (
        "<w:p><w:pPr><w:pStyle w:val=\"ListParagraph\"/>"
        "<w:numPr><w:ilvl w:val=\"0\"/><w:numId w:val=\"2\"/></w:numPr></w:pPr>"
        f"<w:r><w:t xml:space=\"preserve\">{escape(text)}</w:t></w:r></w:p>"
    )


def note(text):
    return (
        "<w:p><w:pPr><w:shd w:fill=\"EFF6FF\"/><w:spacing w:before=\"80\" w:after=\"120\"/>"
        "<w:ind w:left=\"180\" w:right=\"180\"/></w:pPr>"
        f"<w:r><w:rPr><w:color w:val=\"1D4ED8\"/><w:b/></w:rPr><w:t>注意: </w:t></w:r>"
        f"<w:r><w:t xml:space=\"preserve\">{escape(text)}</w:t></w:r></w:p>"
    )


def image_paragraph(rid, caption, px_w, px_h):
    width_in = min(PAGE_CONTENT_WIDTH_IN, 4.7)
    height_in = width_in * px_h / px_w
    if height_in > 3.05:
        height_in = 3.05
        width_in = height_in * px_w / px_h
    cx = int(width_in * EMU_PER_INCH)
    cy = int(height_in * EMU_PER_INCH)
    caption_xml = p(caption, style="Caption")
    drawing = f"""
<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:before="80" w:after="120"/></w:pPr><w:r><w:drawing>
<wp:inline distT="0" distB="0" distL="0" distR="0" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">
<wp:extent cx="{cx}" cy="{cy}"/><wp:docPr id="{rid[3:]}" name="{escape(caption)}"/>
<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
<pic:nvPicPr><pic:cNvPr id="{rid[3:]}" name="{escape(caption)}"/><pic:cNvPicPr/></pic:nvPicPr>
<pic:blipFill><a:blip r:embed="{rid}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>
<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="{cx}" cy="{cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>
</pic:pic>
</a:graphicData>
</a:graphic>
</wp:inline>
</w:drawing></w:r></w:p>
"""
    return caption_xml + drawing


def page_break():
    return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>'


def build_document_xml():
    now = datetime.now().strftime("%Y年%m月%d日")
    body = []
    body.append(p("サイト別入力候補オートコンプリート 取扱説明書", "Title"))
    body.append(p(f"対象: Tampermonkey 用ユーザースクリプト / 作成日: {now}", "Subtitle"))
    body.append(p("この文書は、通常のオートコンプリートが使いにくいサイトで、会社名、担当者名、施設名、物件名などのよく使う文字列を候補表示・入力・コピーするための操作説明書です。", "Normal"))
    body.append(note("このスクリプトは Tampermonkey で動かす前提です。Chrome 標準のオートコンプリート履歴を直接読む機能ではありません。"))
    body.append(p("1. できること", "Heading1"))
    for item in [
        "入力欄に文字を入れると、登録済み候補やサイト別履歴を候補表示します。",
        "候補行クリック、Enter、Tab で入力欄へ反映できます。",
        "コピーアイコンを押すと、入力欄へ反映しながらクリップボードへコピーできます。",
        "履歴はサイト別に保存され、検索・決定ボタンを押した時だけ使用回数が増えます。",
        "サイトごとに機能を有効/無効にできます。",
        "Chrome 標準候補が邪魔な場合は、Chrome候補抑制を有効にできます。",
        "CSV一括登録と全サイトJSON移行で、社内共有やPC移行に対応できます。",
        "複数タブで作業しても候補や履歴が消えにくいよう、保存データを同期します。",
    ]:
        body.append(bullet(item))

    body.append(p("2. インストール", "Heading1"))
    for step in [
        "Chrome に Tampermonkey をインストールします。",
        "Tampermonkey のダッシュボードを開き、「新規スクリプト」を作成します。",
        "mansion-autocomplete.user.js の中身をすべて貼り付けて保存します。",
        "利用したいサイトを再読み込みします。",
    ]:
        body.append(numbered(step))
    body.append(note("イタンジなどログイン後に iframe を使うサイトでは、iframe 側のドメインでも Tampermonkey の実行が許可されている必要があります。"))

    body.append(p("3. 候補を表示して入力する", "Heading1"))
    body.append(p("入力欄に文字を入れると、候補が表示されます。使用回数が多い履歴が上に表示され、手動候補も続いて表示されます。", "Normal"))
    if Path(IMAGES[0][0]).exists():
        body.append(image_paragraph("rIdImg1", "図1: 候補リスト。候補名、コピー、履歴回数、削除が並びます。", *png_size(IMAGES[0][0])))
    body.append(p("候補リストで使える操作", "Heading2"))
    for item in [
        "候補行をクリック: 入力欄へ反映",
        "Enter / Tab: 選択中の候補を入力欄へ反映",
        "⧉: 入力欄へ反映し、同時にコピー",
        "ゴミ箱: その候補を削除",
        "Esc: 候補リストを閉じる",
    ]:
        body.append(bullet(item))

    body.append(p("4. コピーして貼り付ける", "Heading1"))
    body.append(p("別の入力欄や別サイトへ貼り付けたい場合は、候補名の右横にあるコピーアイコンを使います。コピーアイコンは、入力欄への反映とコピーを同時に行います。", "Normal"))
    if Path(IMAGES[3][0]).exists():
        body.append(image_paragraph("rIdImg4", "図2: コピーアイコンを押すと「コピーしました」と表示されます。", *png_size(IMAGES[3][0])))

    body.append(p("5. 設定画面", "Heading1"))
    body.append(p("画面右下の「設定」ボタンから設定画面を開きます。候補の追加、履歴削除、入力モード、Chrome候補抑制、サイト別オン/オフを変更できます。", "Normal"))
    if Path(IMAGES[1][0]).exists():
        body.append(image_paragraph("rIdImg2", "図3: 設定画面。現在サイトの有効/無効、入力モード、Chrome候補抑制を切り替えます。", *png_size(IMAGES[1][0])))
    body.append(p("設定項目の意味", "Heading2"))
    for item in [
        "このサイト: 現在開いているサイトだけ、この機能を有効/無効にします。",
        "入力モード: 通常は「標準」。反映されないサイトでは「キーボード入力風」を試します。",
        "Chrome候補抑制: Chrome 標準候補を出にくくする設定です。",
        "このサイトの候補を追加: 今開いているサイト専用の候補を追加できます。",
        "このサイトの候補: 登録済み候補を検索し、ピン止め、削除、使用回数リセットができます。",
        "移行: 全サイト分の候補や設定をJSONでエクスポート・インポートできます。",
    ]:
        body.append(bullet(item))

    body.append(p("6. CSV一括登録", "Heading1"))
    body.append(p("設定画面の「このサイト候補CSV一括登録」から、現在開いているサイト専用の候補をまとめて追加できます。", "Normal"))
    for item in [
        "name列がある場合はname列を読み込みます。ない場合は1列目を候補名として読み込みます。",
        "UTF-8、UTF-8 BOM付き、UTF-16、Shift-JIS/CP932を自動判定します。",
        "セル内改行がある行や文字化けの可能性がある行はスキップし、結果に行番号を表示します。",
        "CSVエクスポートには候補名、使用回数、最終使用日、ピン止め状態を含めます。",
    ]:
        body.append(bullet(item))

    body.append(p("7. JSON移行", "Heading1"))
    body.append(p("設定画面右上の「移行」、またはTampermonkeyメニューの「移行画面を開く」から、全サイト横断のJSON移行画面を開けます。", "Normal"))
    body.append(p("JSONエクスポート", "Heading2"))
    for item in [
        "出力するサイトをチェックで選択できます。",
        "候補名は常に含まれます。",
        "ピン止め、使用履歴、基本設定を含めるかどうかを選べます。",
        "出力前に対象サイト数、候補数、ピン止め件数、使用履歴、基本設定の有無をプレビュー表示します。",
        "社内共有では、個人の利用傾向が入る使用履歴は外して出力するのがおすすめです。",
    ]:
        body.append(bullet(item))
    body.append(p("JSONインポート", "Heading2"))
    for item in [
        "JSONを選択してもすぐには取り込みません。",
        "対象サイト数、候補数、ピン止め件数、使用履歴、基本設定の有無を確認画面に表示します。",
        "「この内容をインポート」を押した時だけ取り込みます。",
        "既存データは消さずにマージします。",
        "使用履歴を取り込む場合、使用回数は大きい方、最終使用日は新しい方を残します。",
    ]:
        body.append(bullet(item))

    body.append(p("8. サイトごとに無効化する", "Heading1"))
    body.append(p("邪魔になるサイトでは、設定画面の「無効にする」を押します。無効にしたサイトでは右下の設定ボタンだけ残り、候補表示・入力補助・履歴カウント・Chrome候補抑制は止まります。", "Normal"))
    if Path(IMAGES[2][0]).exists():
        body.append(image_paragraph("rIdImg3", "図4: 無効化した状態。「有効にする」を押せば再び使えます。", *png_size(IMAGES[2][0])))

    body.append(p("9. 履歴のカウント仕様", "Heading1"))
    for item in [
        "候補を入力欄へ入れただけでは使用回数は増えません。",
        "フォーム送信、または「検索」「決定」「確定」などのボタンを押した時に +1 されます。",
        "コピーだけでは使用回数は増えません。",
        "同じクリックで二重に記録されないよう、短時間の重複記録は抑制しています。",
    ]:
        body.append(bullet(item))

    body.append(p("10. うまく動かない時", "Heading1"))
    for item in [
        "入力欄に反映されない: 設定画面で入力モードを「キーボード入力風」に切り替えます。",
        "Chrome の候補が被る: Chrome候補抑制を有効にします。",
        "特定サイトで邪魔: このサイトを無効にします。",
        "候補が出ない: Tampermonkey がそのページ、または iframe のドメインで有効か確認します。",
        "入力履歴が増えない: 実際に検索・決定ボタンを押したか確認します。",
    ]:
        body.append(bullet(item))

    body.append(p("11. 注意事項", "Heading1"))
    body.append(note("Chrome ウェブストア、ブラウザ設定画面、拡張機能の実行が禁止された業務画面では動作しません。"))
    body.append(note("Chrome 標準の保存済みオートコンプリート履歴は、Tampermonkey から直接読み取れません。このスクリプトは、今後の入力・検索履歴を独自に保存します。"))
    body.append(note("JSON移行で使用履歴を含めると、個人の利用傾向が共有される可能性があります。社内配布用JSONでは必要な場合だけ使用履歴を含めてください。"))

    sect = """
<w:sectPr>
<w:pgSz w:w="12240" w:h="15840"/>
<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>
<w:cols w:space="720"/>
<w:docGrid w:linePitch="360"/>
</w:sectPr>
"""
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" '
        'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
        'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">'
        "<w:body>"
        + "".join(body)
        + sect
        + "</w:body></w:document>"
    )


def styles_xml():
    return """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="Yu Gothic"/><w:sz w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="259" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="Yu Gothic"/><w:sz w:val="22"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="220"/></w:pPr><w:rPr><w:b/><w:color w:val="1D4ED8"/><w:sz w:val="44"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="260"/></w:pPr><w:rPr><w:color w:val="64748B"/><w:sz w:val="24"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="260" w:after="140"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:color w:val="0F172A"/><w:sz w:val="32"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="180" w:after="90"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:color w:val="334155"/><w:sz w:val="28"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Caption"><w:name w:val="Caption"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:jc w:val="center"/><w:spacing w:before="120" w:after="70"/></w:pPr><w:rPr><w:i/><w:color w:val="64748B"/><w:sz w:val="19"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:ind w:left="720" w:hanging="360"/><w:spacing w:after="110"/></w:pPr></w:style>
</w:styles>"""


def numbering_xml():
    return """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr><w:rPr><w:rFonts w:ascii="Symbol" w:hAnsi="Symbol"/></w:rPr></w:lvl></w:abstractNum>
<w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num>
<w:abstractNum w:abstractNumId="2"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum>
<w:num w:numId="2"><w:abstractNumId w:val="2"/></w:num>
</w:numbering>"""


def rels_xml():
    available_images = [(path, caption) for path, caption in IMAGES if Path(path).exists()]
    img_rels = "\n".join(
        f'<Relationship Id="rIdImg{i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image{i}.png"/>'
        for i in range(1, len(available_images) + 1)
    )
    return f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
<Relationship Id="rIdNumbering" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>
{img_rels}
</Relationships>"""


def content_types_xml():
    return """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Default Extension="png" ContentType="image/png"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>
</Types>"""


def root_rels_xml():
    return """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>"""


def app_xml():
    return """<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Codex</Application></Properties>"""


def core_xml():
    return """<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/"><dc:title>サイト別入力候補オートコンプリート 取扱説明書</dc:title><dc:creator>Codex</dc:creator></cp:coreProperties>"""


def main():
    available_images = [(path, caption) for path, caption in IMAGES if Path(path).exists()]

    with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", content_types_xml())
        z.writestr("_rels/.rels", root_rels_xml())
        z.writestr("docProps/app.xml", app_xml())
        z.writestr("docProps/core.xml", core_xml())
        z.writestr("word/document.xml", build_document_xml())
        z.writestr("word/styles.xml", styles_xml())
        z.writestr("word/numbering.xml", numbering_xml())
        z.writestr("word/_rels/document.xml.rels", rels_xml())
        for i, (path, _) in enumerate(available_images, start=1):
            z.write(path, f"word/media/image{i}.png")

    print(OUT.resolve())


if __name__ == "__main__":
    main()
