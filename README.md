LaTexVision

LaTexVision is an AI-powered tool that converts images of handwritten or printed mathematical content and text into clean, structured LaTeX code.

The project is designed as a hybrid system and can operate both with cloud-based AI services and in a fully offline local mode.

--------------------------------------------------
ARCHITECTURE
--------------------------------------------------

LaTexVision uses a hybrid architecture:

1) Frontend
   - React
   - Vite
   - TailwindCSS
   Provides a web interface for uploading documents, editing LaTeX, and previewing results.

2) Cloud API (optional)
   - Vercel Serverless Functions
   - Google Gemini (Flash)
   Used for fast processing when internet access is available.

3) Local Backend (offline mode)
   - Python Flask server
   - Qwen2.5-VL-7B-Instruct
   Enables private, offline processing without any external network access.

--------------------------------------------------
FEATURES
--------------------------------------------------

- Multipage PDF support for full document processing
- Intelligent layout segmentation using OpenCV (client-side via WebAssembly)
- Hybrid AI processing:
  - Cloud Mode: Google Gemini for speed and convenience
  - Offline Mode: Local Qwen2.5-VL model for privacy and offline use
- Integrated LaTeX editor with live preview (KaTeX)
- Manual layout tools:
  - Adjust text blocks
  - Erase artifacts
  - Split multi-column layouts

--------------------------------------------------
INSTALLATION
--------------------------------------------------

--------------------------------------------------
1) Frontend (Node.js)
--------------------------------------------------

Requirements:
- Node.js 18+

Installation:

npm install
npm run dev

For cloud-based features (Google Gemini), create a .env.local file:

API_KEY=your_google_gemini_api_key

--------------------------------------------------
2) Local Backend (Python)
--------------------------------------------------

The local backend is required for Offline Mode.

Requirements:
- Python 3.10 or newer
- NVIDIA GPU recommended
  - 12 GB VRAM or more recommended for the 7B model
- CUDA Toolkit compatible with your GPU

Setup:

cd backend
python -m venv venv

Windows:
venv\Scripts\activate

Linux / macOS:
source venv/bin/activate

Install dependencies:

pip install -r requirements.txt

--------------------------------------------------
MODEL DOWNLOAD
--------------------------------------------------

LaTexVision does not download large model files automatically at runtime.

To download the Qwen2.5-VL model, use the provided script:

python download_model.py

This script will:
- Download all required model files from Hugging Face
- Store them in a local directory on disk
- Prepare the model for offline use

After downloading, set the MODEL_PATH variable in server.py
to point to the local model directory.

--------------------------------------------------
FULLY OFFLINE MODE
--------------------------------------------------

LaTexVision can run in a fully offline environment.

To enable fully offline mode:

1) Download the model in advance using:
   python download_model.py

2) Set MODEL_PATH in server.py to the local model directory.

3) Ensure the backend uses:
   - local_files_only=True
   - No cloud API keys configured
   - No external inference services enabled

4) Start the backend server:
   python server.py

In this mode:
- The application will not access the internet
- No model files will be downloaded at runtime
- All inference runs locally on your hardware

--------------------------------------------------
LICENSES AND ATTRIBUTION
--------------------------------------------------

--------------------------------------------------
Application Code
--------------------------------------------------

The source code of LaTexVision is licensed under the MIT License.

See the LICENSE file for full license text.

--------------------------------------------------
Third-Party Models
--------------------------------------------------

This project supports the use of Qwen2.5-VL models developed by the Qwen Team
(Alibaba Cloud).

Model:
- Qwen2.5-VL-7B-Instruct

License:
- Apache License, Version 2.0

Use of the Qwen model is subject to its original license terms.
The model itself is not redistributed as part of this repository.

--------------------------------------------------
DISCLAIMER
--------------------------------------------------

LaTexVision is provided "as is", without warranty of any kind.
The authors are not responsible for errors in generated LaTeX output,
model hallucinations, or formatting inconsistencies.

Users are responsible for reviewing and validating generated content
before publication or production use.
