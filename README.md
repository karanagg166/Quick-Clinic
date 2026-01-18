# 🚑 QuickClinic - Healthcare Management Platform

A modern, full-stack healthcare management system built with Next.js, Prisma, and real-time communication. QuickClinic seamlessly connects patients, doctors, and administrators through an intuitive platform.

## ✨ Features

- 🔐 **Role-Based Authentication** - Separate portals for Patients, Doctors, and Admins
- 📅 **Appointment Management** - Schedule, reschedule, and manage appointments
- 💬 **Real-Time Chat** - Socket.IO powered instant messaging between patients and doctors
- 📊 **Analytics Dashboard** - Comprehensive statistics and insights for doctors and admins
- 🔔 **Live Notifications** - Real-time updates for appointments and onboarding requests
- 🎨 **Modern UI** - Beautiful, responsive design with dark mode support
- 🔒 **Secure** - JWT authentication, role-based access control, and audit logging

## 🚀 Quick Start

### Prerequisites

- **Docker Desktop** (required)
- **Git** (required)
- No need for Node.js, PostgreSQL, or Redis locally!

### 1️⃣ Clone the Repository

```bash
git clone <your-repo-url>
cd quick-clinic
```

### 2️⃣ Configure Environment

```bash
cp .env.example .env
```

Update `.env` with your credentials:

```env
DATABASE_URL="your-neon-postgres-url"
UPSTASH_REDIS_REST_URL="your-upstash-rest-url"
UPSTASH_REDIS_REST_TOKEN="your-upstash-rest-token"
REDIS_URL="your-upstash-redis-url"
NODE_ENV="production"
```

### 3️⃣ Build & Start with Docker

```bash
# Build and start containers
docker compose up --build -d

# Generate Prisma Client
docker compose exec app npx prisma generate

# Apply database migrations
docker compose exec app npx prisma migrate deploy
```

### 4️⃣ Access the Application

- **Web App**: http://localhost:3000
- **Socket.IO Server**: http://localhost:4000
- **Health Check**: http://localhost:4000/health

## 🧪 Test Credentials

Use these pre-configured accounts to explore the platform:

### 👨‍⚕️ Doctor Account
- **Email**: harsh@gmail.com
- **Password**: harsh166

### 👤 Patient Account
- **Email**: priyanshu@gmail.com
- **Password**: priyanshu166

### 🔧 Admin Account
- **Email**: karan@gmail.com
- **Password**: karan166

## 🛠 Development Commands

### Docker Management

```bash
# Start the application
docker compose up

# Stop the application
docker compose down

# Rebuild after installing packages
docker compose up --build
```

### Prisma Commands

```bash
# Format schema
docker compose exec app npx prisma format

# Validate schema
docker compose exec app npx prisma validate

# Generate Prisma Client
docker compose exec app npx prisma generate

# Push schema to database (dev)
docker compose exec app npx prisma db push

# Pull schema from database
docker compose exec app npx prisma db pull

# Create and apply migration (dev)
docker compose exec app npx prisma migrate dev --name <migration-name>

# Apply migrations (production)
docker compose exec app npx prisma migrate deploy

# Open Prisma Studio (Database GUI)
docker compose exec app npx prisma studio
```

## 📁 Project Structure

```
quick-clinic/
├── src/
│   ├── app/              # Next.js app directory
│   │   ├── (protected)/  # Protected routes (patient, doctor, admin)
│   │   ├── api/          # API routes
│   │   └── auth/         # Authentication pages
│   ├── components/       # React components
│   ├── lib/              # Utility functions and configurations
│   └── types/            # TypeScript type definitions
├── prisma/
│   └── schema.prisma     # Database schema
├── socket-server/        # Socket.IO server for real-time features
├── docker-compose.yml    # Docker configuration
└── Dockerfile            # Container image definition
```

## 🔧 Tech Stack

- **Frontend**: Next.js 14, React, TypeScript, TailwindCSS
- **Backend**: Next.js API Routes, Prisma ORM
- **Database**: PostgreSQL (Neon)
- **Cache/Sessions**: Redis (Upstash)
- **Real-time**: Socket.IO
- **Authentication**: JWT, bcrypt
- **Deployment**: Docker, Docker Compose

## 🎯 User Roles & Capabilities

### Patient Portal
- Book appointments with available doctors
- View appointment history and status
- Real-time chat with assigned doctors
- Manage profile and medical information

### Doctor Portal
- Manage appointment requests (accept/reject)
- View patient details and appointment history
- Real-time chat with patients
- Analytics dashboard with statistics

### Admin Portal
- Manage doctor onboarding requests
- View system-wide analytics and logs
- Monitor user activity and audit trails
- Real-time notifications for new requests

## 🔒 Security Features

- JWT-based authentication with HTTP-only cookies
- Role-based access control (RBAC)
- Password hashing with bcrypt
- Audit logging for sensitive operations
- Protected API routes with middleware
- CORS configuration for Socket.IO

## 📝 License

This project is created by **Karan Aggarwal** & **Harsh Mishra**.

## 🤝 Contributing

Contributions, issues, and feature requests are welcome!

## 📧 Contact

For questions or support, reach out to:
- **Email**: aggarwalkaran241@gmail.com
- **GitHub**: [@karanagg166](https://github.com/karanagg166)

---

Made with ❤️ by Karan Aggarwal & Harsh Mishra
