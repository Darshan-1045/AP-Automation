# AP Automation – Intelligent Accounts Payable Automation

An intelligent Accounts Payable (AP) Automation system designed to streamline invoice processing through OCR-based data extraction, automated validation, invoice matching, and approval workflows.

The platform aims to reduce manual data entry, improve invoice processing accuracy, and provide better visibility into accounts payable operations.

## 🚀 Project Overview

AP Automation is a full-stack web application that automates key stages of the accounts payable lifecycle.

The system enables users to upload invoices, extract invoice information using OCR, validate extracted data, manage invoice records, and track processing activities through a centralized dashboard.

### Key Objectives

- Automate invoice capture and processing.
- Extract invoice information using OCR.
- Validate invoice details and financial data.
- Identify duplicate invoices.
- Streamline invoice approval workflows.
- Provide centralized invoice management and reporting.

## ✨ Features

### 1. Invoice Management
- Upload invoices in PDF and image formats.
- Support multiple invoice documents.
- Store and manage uploaded invoices.
- View invoice details and processing status.

### 2. OCR-Based Data Extraction
- Extract text from PDF and image invoices.
- Process multi-page PDF documents.
- Extract important invoice information.
- Support invoice line-item extraction.
- Reduce manual data entry.

### 3. Invoice Validation
- Validate mandatory invoice fields.
- Identify duplicate invoices.
- Validate invoice amounts.
- Perform tax and GST-related checks.
- Validate vendor information.

### 4. Authentication and Authorization
- User registration and login.
- DRF token-based authentication. Login identifies the user and issues a token; `/api/auth/me/` returns identity only.
- Protected API endpoints require authentication. Every authenticated user can use the available application modules; Django Groups are not used to authorize application access.
- Authenticated frontend requests.
- Registration never assigns an application role. Existing Django groups and historical approval-rule labels may remain in the database but are unused for access control.

### 5. Dashboard and Analytics
- Centralized invoice overview.
- Invoice processing status.
- Pending invoice tracking.
- Invoice-related statistics.
- Processing insights.

### 6. Backend API
- RESTful API architecture.
- Django REST Framework integration.
- PostgreSQL database support.
- Structured invoice processing endpoints.

## 🛠️ Technology Stack

| Category | Technologies |
|---|---|
| Frontend | React.js, JavaScript, HTML5, CSS3 |
| Build Tool | Vite |
| Backend | Python, Django |
| API | Django REST Framework |
| Database | PostgreSQL |
| OCR | Tesseract OCR, Pytesseract |
| Image Processing | Pillow |
| PDF Processing | pypdf, pdf2image, Poppler |
| Authentication | Token-Based Authentication |
| API Integration | Axios |
| Version Control | Git, GitHub |
| Frontend Deployment | Vercel |
| Backend Deployment | Render (planned) |

## 🏗️ System Architecture

```text
              USER
                |
                v
       React.js Frontend
          (Vite + Axios)
                |
                v
          REST API
                |
                v
        Django Backend
                |
       +--------+---------+
       |        |         |
       v        v         v
    Invoice    OCR     Validation
    Upload  Processing   Engine
       |        |         |
       +--------+---------+
                |
                v
           PostgreSQL
                |
                v
        Dashboard & Reports
```

## 📂 Project Structure

```text
AP-Automation/
│
├── frontend/
│   ├── public/
│   ├── src/
│   │   ├── api/
│   │   ├── assets/
│   │   ├── components/
│   │   ├── pages/
│   │   ├── hooks/
│   │   ├── services/
│   │   ├── App.jsx
│   │   └── main.jsx
│   ├── .env
│   ├── package.json
│   └── vite.config.js
│
├── Backend/
│   ├── config/
│   ├── invoices/
│   │   ├── migrations/
│   │   ├── tests.py
│   │   ├── models.py
│   │   ├── views.py
│   │   ├── serializers.py
│   │   └── ...
│   ├── media/
│   ├── requirements.txt
│   ├── manage.py
│   └── .env
│
├── .gitignore
└── README.md
```

*Note: The structure is illustrative; adjust it to match the final repository.*

## ⚙️ Installation and Setup

### Prerequisites

- Python 3.10+
- Node.js and npm
- PostgreSQL
- Tesseract OCR
- Poppler
- Git

### 1. Clone the Repository

```bash
git clone YOUR_GITHUB_REPOSITORY_URL
cd AP-Automation
```

### 2. Backend Setup

```bash
cd Backend

python -m venv venv
```

Activate the virtual environment.

**Windows:**

```powershell
venv\Scripts\activate
```

**Linux/macOS:**

```bash
source venv/bin/activate
```

Install dependencies:

```bash
pip install -r requirements.txt
```

Configure the backend `.env` file with the required Django secret, database credentials, and other environment variables.

Apply migrations:

```bash
python manage.py migrate
```

Start the backend:

```bash
python manage.py runserver
```

Backend development URL:

```text
http://127.0.0.1:8000/
```

### 3. Frontend Setup

Open another terminal:

```bash
cd frontend
npm install
```

Create a `.env` file:

```env
VITE_API_BASE_URL=http://127.0.0.1:8000/api
```

Start the frontend:

```bash
npm run dev
```

Frontend development URL:

```text
http://localhost:5173/
```

## 🌐 API Configuration

The frontend communicates with the Django backend through Axios.

Example API configuration:

```javascript
const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL,
  timeout: 30000,
  headers: {
    Accept: "application/json",
  },
});
```

Authentication tokens are attached to protected API requests through an Axios request interceptor.

## 🚀 Deployment

The application is planned for cloud deployment using separate frontend and backend hosting.

### Frontend – Vercel

1. Push the frontend source code to GitHub.
2. Import the repository into Vercel.
3. Configure the frontend root directory.
4. Add the production environment variable:

```env
VITE_API_BASE_URL=YOUR_DEPLOYED_BACKEND_API_URL
```

5. Build command:

```bash
npm run build
```

6. Output directory:

```text
dist
```

### Backend – Render

The Django backend is planned for deployment on Render.

Deployment configuration will include:

- Python runtime and dependency installation.
- Gunicorn production server.
- PostgreSQL database connection.
- Environment variable configuration.
- Tesseract OCR and Poppler system dependencies.
- Django static file configuration.
- CORS configuration for the deployed frontend.

### Deployment Links

| Resource | URL |
|---|---|
| Live Application | Coming Soon |
| Backend API | Coming Soon |
| GitHub Repository | Coming Soon |

## 🔐 Security Considerations

- Environment variables are used for sensitive configuration.
- Backend secrets are not exposed to the frontend.
- Token-based authentication protects API endpoints.
- CORS is configured to restrict frontend origins.
- Database credentials are maintained separately from source code.

## 🔮 Future Enhancements

- AI-powered invoice field identification.
- Advanced invoice line-item extraction.
- Purchase Order (PO) matching.
- Two-way and three-way invoice matching.
- Configurable approval workflows.
- Vendor management and onboarding.
- Payment tracking and payment advice generation.
- Invoice aging and exception reports.
- Audit logs and GST reporting.
- ERP and accounting system integrations.

## 👨‍💻 Author

**Darshan P.**

- GitHub: [Add GitHub Profile]


---

*AP Automation – Simplifying invoice processing through intelligent automation.*