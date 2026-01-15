import base64
import io
import gc
import re
import torch

from flask import Flask, request, jsonify
from flask_cors import CORS
from PIL import Image

from transformers import (
    Qwen2_5_VLForConditionalGeneration,
    AutoProcessor,
    BitsAndBytesConfig,
)
from qwen_vl_utils import process_vision_info


# --------------------
# CONFIG
# --------------------
PORT = 5000
MODEL_PATH = r"D:\models\Qwen2.5-VL-7B-Instruct"

MAX_PIXELS = 1024 * 1024
device = "cuda" if torch.cuda.is_available() else "cpu"

if device == "cuda":
    torch.cuda.set_per_process_memory_fraction(0.9, 0)


# --------------------
# APP
# --------------------
app = Flask(__name__)
CORS(app)


# --------------------
# MODEL LOAD (OFFLINE)
# --------------------
quantization_config = BitsAndBytesConfig(
    load_in_4bit=True,
    bnb_4bit_compute_dtype=torch.float16,
    bnb_4bit_quant_type="nf4",
    bnb_4bit_use_double_quant=True,
)

print("Loading model...")

model = Qwen2_5_VLForConditionalGeneration.from_pretrained(
    MODEL_PATH,
    quantization_config=quantization_config,
    device_map="auto",
    attn_implementation="sdpa",
    local_files_only=True,
).eval()

processor = AutoProcessor.from_pretrained(
    MODEL_PATH,
    local_files_only=True,
)

print("Model loaded (offline).")


# --------------------
# UTILS
# --------------------
def resize_image(image: Image.Image) -> Image.Image:
    w, h = image.size
    if w * h <= MAX_PIXELS:
        return image
    scale = (MAX_PIXELS / (w * h)) ** 0.5
    return image.resize((int(w * scale), int(h * scale)), Image.BICUBIC)


def strip_code_fences(text: str) -> str:
    text = re.sub(r"```(?:latex)?", "", text, flags=re.IGNORECASE)
    return text.strip()


def strip_textbf(text: str) -> str:
    while True:
        new = re.sub(r"\\textbf\{([^{}]*)\}", r"\1", text)
        if new == text:
            return new
        text = new


def clean_repetitions(text: str) -> str:
    lines = text.splitlines()
    seen = set()
    result = []

    for line in lines:
        key = re.sub(r"\s+", "", line)
        if len(key) > 10 and key in seen:
            continue
        seen.add(key)
        result.append(line)

    return "\n".join(result)


def post_clean(text: str) -> str:
    text = strip_code_fences(text)
    text = strip_textbf(text)
    text = re.sub(r"\\documentclass[\s\S]*?\\begin\{document\}", "", text)
    text = re.sub(r"\\end\{document\}", "", text)
    text = re.sub(r"\\mathrm", "\\text", text)
    text = clean_repetitions(text)
    return text.strip()


# --------------------
# OCR ENDPOINT
# --------------------
@app.route("/api/convert", methods=["POST"])
def convert_image():
    try:
        data = request.json
        if not data or "base64Data" not in data:
            return jsonify({"error": "No image data"}), 400

        image_b64 = data["base64Data"].split(",")[-1]
        image = Image.open(io.BytesIO(base64.b64decode(image_b64))).convert("RGB")
        image = resize_image(image)

        prompt = (
            "Transcribe the image into LaTeX.\n"
            "Elements:\n"
            "- plain text\n"
            "- inline formulas ($...$)\n"
            "- standalone formulas (\$begin:math:display$ \.\.\. \\$end:math:display$)\n\n"
            "Rules:\n"
            "- Preserve content and order exactly\n"
            "- Do NOT invent or solve anything\n"
            "- Output LaTeX only\n"
            "- No document headers or packages"
        )
        messages = [{
            "role": "user",
            "content": [
                {"type": "image", "image": image},
                {"type": "text", "text": prompt},
            ],
        }]

        text_input = processor.apply_chat_template(
            messages, tokenize=False, add_generation_prompt=True
        )

        image_inputs, video_inputs = process_vision_info(messages)

        inputs = processor(
            text=[text_input],
            images=image_inputs,
            videos=video_inputs,
            padding=True,
            return_tensors="pt",
        ).to(model.device)

        with torch.inference_mode():
            generated = model.generate(
                **inputs,
                max_new_tokens=1024,
                do_sample=False,
            )

        output_ids = generated[:, inputs.input_ids.shape[1]:]
        text = processor.batch_decode(
            output_ids,
            skip_special_tokens=True,
            clean_up_tokenization_spaces=False,
        )[0]

        return jsonify({"text": post_clean(text)})

    except Exception as e:
        return jsonify({"error": str(e)}), 500

    finally:
        torch.cuda.empty_cache()
        gc.collect()


# --------------------
# REFACTOR ENDPOINT (с кастомным промтом)
# --------------------
@app.route("/api/refactor", methods=["POST"])
def refactor_text():
    try:
        data = request.json
        if not data or "text" not in data:
            return jsonify({"error": "No text provided"}), 400

        raw_text = data["text"]
        user_prompt = data.get("prompt", "")  # кастомный промт от пользователя, необязательный

        # Основной строгий промт, который нельзя сломать
        strict_prompt = (
            "Вы получили LaTeX текст, сгенерированный из OCR.\n"
            "Обязательные правила (не изменяйте):\n"
            "- Сохраняйте порядок и содержание текста полностью.\n"
            "- Не добавляйте новый контент.\n"
            "- Не пиши дополнительных ответов пользователю, строго по промту.\n"
            "- Не удаляйте информацию.\n"
            "- Сохраняйте язык оригинала, включая старорусские буквы и символы (ъ, i).\n"
            "- Форматирование LaTeX должно быть корректным.\n"
            "- Inline формулы остаются $...$, отдельные формулы остаются \\[ ... \\].\n"
            "- Заголовки и обычный текст сохраняются как есть (\\textbf будет удалено в пост-обработке).\n\n"
            "Пользовательский запрос:\n"
        )

        full_prompt = strict_prompt + user_prompt + "\n\nТекст для обработки:\n" + raw_text

        messages = [{
            "role": "user",
            "content": [{"type": "text", "text": full_prompt}],
        }]

        text_input = processor.apply_chat_template(
            messages, tokenize=False, add_generation_prompt=True
        )

        inputs = processor(
            text=[text_input],
            padding=True,
            return_tensors="pt",
        ).to(model.device)

        with torch.inference_mode():
            generated = model.generate(
                **inputs,
                max_new_tokens=1024,
                do_sample=False,
            )

        output_ids = generated[:, inputs.input_ids.shape[1]:]
        text = processor.batch_decode(
            output_ids,
            skip_special_tokens=True,
            clean_up_tokenization_spaces=False,
        )[0]

        return jsonify({"text": post_clean(text)})

    except Exception as e:
        return jsonify({"error": str(e)}), 500

    finally:
        torch.cuda.empty_cache()
        gc.collect()


# --------------------
if __name__ == "__main__":
    app.run(host="0.0.0.0", port=PORT, debug=False)
