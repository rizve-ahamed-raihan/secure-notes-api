# Secure Note-Taking Application (REST API + Functional Frontend)

> Technical Interview Implementation Specification & Documentation

---

## 1. Project Overview




A robust, production-ready RESTful API and minimal functional frontend for a **Secure Note-Taking Application** with role-based access control (RBAC), database indexing optimizations, and targeted MongoDB aggregation pipelines.

Designed for seamless deployment to **Vercel** via automated **GitHub Actions CI/CD workflows**.

### Key Objectives
- **Secure Authentication & RBAC**: JWT-based authentication with bcrypt password hashing; granular permissions distinguishing standard `User` and privileged `Admin`.
- **Database Optimization**: Deliberate, minimal, and efficient MongoDB indexes using Mongoose `schema.index()` adhering strictly to ESR (Equality, Sort, Range) principles. Zero redundant indexes.
- **Advanced Aggregation Pipelines**:
  1. *Group by Interests*: Single-pipeline `$unwind` + `$group` aggregation with index support.
  2. *User Posts ($lookup)*: Single-pipeline `$lookup` relational aggregation.
- **Serverless-Ready Architecture**: Stateless Express application optimized for Vercel serverless execution with Mongoose connection pooling/caching.
- **Functional Frontend**: Vanilla, zero-template, lightweight frontend focusing entirely on API integration and functionality.
- **CI/CD Pipeline**: GitHub Actions for automated linting, test execution, and deployment to Vercel.

---

## 2. Technical Stack

| Layer | Technology | Purpose |
| :--- | :--- | :--- |
| **Runtime** | Node.js (>= 18.x) | Core server execution |
| **Framework** | Express.js | Modular REST API routing & middleware |
| **Database** | MongoDB Atlas with Mongoose (8.x) | Document database & Object Data Modeling (ODM) |
| **Authentication** | JSON Web Tokens (`jsonwebtoken`) | Stateless bearer token authentication |
| **Security** | `bcryptjs`, `helmet`, `cors` | Password hashing, secure HTTP headers, CORS policies |
| **Frontend** | Vanilla HTML5, CSS3, JavaScript (Fetch API) | Functional UI (zero bloat, zero framework templates) |
| **Deployment** | Vercel Serverless Functions | Serverless hosting for backend API & frontend |
| **CI/CD** | GitHub Actions | Automated build, test, and production deployment |

---

## 3. Roles and Permissions Matrix

| Capability | User | Admin | Endpoint(s) |
| :--- | :---: | :---: | :--- |
| Register / Login / View Self Profile | ✅ | ✅ | `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/profile` |
| Create Note | ✅ | ✅ | `POST /api/notes` |
| View Own Notes (Paginated) | ✅ | ✅ | `GET /api/notes` |
| View Single Note (Owned) | ✅ | ✅ | `GET /api/notes/:id` |
| Update / Delete Note (Owned) | ✅ | ✅ | `PUT /api/notes/:id`, `DELETE /api/notes/:id` |
| View All Notes (Across All Users) | ❌ | ✅ | `GET /api/admin/notes` (or `GET /api/notes?all=true`) |
| Manage Users (Add, Update, Delete) | ❌ | ✅ | `POST /api/admin/users`, `PUT /api/admin/users/:id`, `DELETE /api/admin/users/:id` |
| List All Users (Paginated) | ❌ | ✅ | `GET /api/admin/users` |
| Create / View Public Posts | ✅ | ✅ | `POST /api/posts`, `GET /api/posts` |
| Run Aggregation 1: Group by Interests | ✅ | ✅ | `GET /api/aggregations/users-by-interest` |
| Run Aggregation 2: User Posts ($lookup) | ✅ | ✅ | `GET /api/aggregations/users/:userId/posts` |

---

## 4. Database Schema & Indexing Rationale

> **Constraint Compliance**: Indexes are defined explicitly via `schema.index()` and strictly restricted to necessary query patterns.

### 4.1. User Schema (`src/models/User.js`)
- **Fields**:
  - `_id`: ObjectId (Default unique index created by MongoDB)
  - `name`: String, required, trimmed
  - `email`: String, required, unique, lowercase, trimmed
  - `password`: String, required (bcrypt hashed, `select: false` by default for security)
  - `role`: String, enum: `['user', 'admin']`, default: `'user'`
  - `interests`: `[String]`, lowercase, trimmed
  - `createdAt`, `updatedAt`: Timestamps
- **Explicit Indexes**:
  ```javascript
  // 1. Unique index for authentication lookups
  userSchema.index({ email: 1 }, { unique: true });

  // 2. Multikey index supporting Aggregation Scenario 1 (Group by Interests)
  userSchema.index({ interests: 1 });

  // 3. Admin user listing with pagination sorted by registration date
  userSchema.index({ createdAt: -1 });
  ```

### 4.2. Note Schema (`src/models/Note.js`)
- **Fields**:
  - `_id`: ObjectId (Default unique index)
  - `title`: String, required, trimmed
  - `content`: String, required
  - `user`: ObjectId, ref: `'User'`, required
  - `createdAt`, `updatedAt`: Timestamps
- **Explicit Indexes**:
  ```javascript
  // 1. Compound index (ESR: Equality on user, Sort on createdAt) for paginated user notes
  noteSchema.index({ user: 1, createdAt: -1 });

  // 2. Index for admin viewing all notes sorted chronologically with pagination
  noteSchema.index({ createdAt: -1 });
  ```

### 4.3. Post Schema (`src/models/Post.js`)
- **Fields**:
  - `_id`: ObjectId (Default unique index)
  - `title`: String, required, trimmed
  - `content`: String, required
  - `author`: ObjectId, ref: `'User'`, required
  - `createdAt`, `updatedAt`: Timestamps
- **Explicit Indexes**:
  ```javascript
  // 1. Index supporting Aggregation Scenario 2 ($lookup foreignField match) & user-filtered posts
  postSchema.index({ author: 1, createdAt: -1 });
  ```

### 4.4. Index Efficiency Audit Table
| Index | Collection | Query / Operation Supported | Why It Is Minimal & Necessary |
| :--- | :--- | :--- | :--- |
| `{ email: 1 }` | `users` | User Login & Registration uniqueness | Enables O(1) B-tree lookup without full collection scan |
| `{ interests: 1 }` | `users` | Scenario 1 Aggregation | Enables multikey index scan over interest tags |
| `{ createdAt: -1 }` | `users` | Admin User Management pagination | Avoids in-memory sort during paginated list operations |
| `{ user: 1, createdAt: -1 }` | `notes` | User Notes list (`GET /api/notes?page=X`) | Satisfies equality filter (`user`) + sort order (`createdAt: -1`) in single index scan |
| `{ createdAt: -1 }` | `notes` | Admin All Notes list (`GET /api/admin/notes`) | Supports global pagination without user filter |
| `{ author: 1, createdAt: -1 }` | `posts` | Scenario 2 Aggregation ($lookup) & Post list | Enables indexed join lookups on `foreignField: "author"` |

---

## 5. MongoDB Aggregation Pipeline Specifications

### Scenario 1: Group Users by Interests
- **Requirement**: Specific view grouping users by their individual interests using **exactly one** `collection.aggregate()` call.
- **Implementation**:
  ```javascript
  const result = await User.aggregate([
    // Step 1: Deconstruct interests array into separate documents
    { $unwind: "$interests" },
    // Step 2: Group by interest tag and accumulate user metadata
    {
      $group: {
        _id: "$interests",
        totalUsers: { $sum: 1 },
        users: {
          $push: {
            _id: "$_id",
            name: "$name",
            email: "$email",
            role: "$role"
          }
        }
      }
    },
    // Step 3: Sort interests alphabetically
    { $sort: { _id: 1 } }
  ]);
  ```

### Scenario 2: Retrieve User Posts with `$lookup`
- **Requirement**: Retrieve all posts belonging to a particular user using a **single aggregation pipeline with a `$lookup` stage**.
- **Implementation**:
  ```javascript
  const targetUserId = new mongoose.Types.ObjectId(userId);

  const result = await User.aggregate([
    // Step 1: Filter to target user using indexed _id
    { $match: { _id: targetUserId } },
    // Step 2: Relational join with posts collection
    {
      $lookup: {
        from: "posts",
        localField: "_id",
        foreignField: "author",
        as: "posts"
      }
    },
    // Step 3: Project user details and associated posts
    {
      $project: {
        password: 0,
        __v: 0
      }
    }
  ]);
  ```

---

## 6. REST API Endpoints Specification

### Authentication & User
- `POST /api/auth/register` - Create account (`name`, `email`, `password`, `interests`)
- `POST /api/auth/login` - Authenticate & obtain JWT
- `GET /api/auth/profile` - View authenticated user profile (Protected)

### Notes Management
- `GET /api/notes?page=1&limit=10` - List user's notes with pagination metadata
- `POST /api/notes` - Create a note (`title`, `content`)
- `GET /api/notes/:id` - Get specific note (Owner or Admin)
- `PUT /api/notes/:id` - Update note (Owner only)
- `DELETE /api/notes/:id` - Delete note (Owner only)

### Admin Operations (Role: `admin` only)
- `GET /api/admin/users?page=1&limit=10` - List all users (Paginated)
- `POST /api/admin/users` - Create user with explicit role
- `PUT /api/admin/users/:id` - Update user details or role
- `DELETE /api/admin/users/:id` - Delete user
- `GET /api/admin/notes?page=1&limit=10` - View all users' notes (Paginated)

### Public Posts
- `GET /api/posts?page=1&limit=10` - List all public posts (Paginated)
- `POST /api/posts` - Create a public post (Protected)

### Aggregations
- `GET /api/aggregations/users-by-interest` - Scenario 1 aggregation result
- `GET /api/aggregations/users/:userId/posts` - Scenario 2 aggregation result

---

## 7. Functional Frontend Design

The frontend is contained entirely in `public/` and served statically:
- **`public/index.html`**: Clean semantic interface with tabbed views:
  1. **Auth Tab**: Login / Register / Current session info.
  2. **My Notes Tab**: Create, edit, delete, and paginated list of notes.
  3. **Public Posts Tab**: Create and read community posts.
  4. **Aggregations Tab**: Interactive controls to view users grouped by interests, and look up posts by user ID.
  5. **Admin Console Tab**: Rendered only when authenticated user is an `admin` (user management + all notes view).
- **`public/app.js`**: Pure JavaScript utilizing `fetch()` and Bearer token headers in `localStorage`.
- **`public/style.css`**: Minimal CSS for clean layout, readability, and immediate feedback (status messages/loaders).

---

## 8. Vercel Deployment & Serverless Integration

### 8.1. Directory Structure for Vercel
```
secure-notes-api/
├── .github/
│   └── workflows/
│       ├── ci.yml                 # Automated tests & lint checks
│       └── deploy.yml             # Automatic Vercel deployment on main branch
├── api/
│   └── index.js                   # Serverless function entry point for Vercel
├── public/                        # Functional frontend
│   ├── index.html
│   ├── style.css
│   └── app.js
├── src/
│   ├── config/
│   │   └── db.js                  # Cached Mongoose connection handler
│   ├── controllers/
│   │   ├── authController.js
│   │   ├── noteController.js
│   │   ├── postController.js
│   │   ├── adminController.js
│   │   └── aggregationController.js
│   ├── middleware/
│   │   ├── authMiddleware.js      # JWT verification
│   │   ├── roleMiddleware.js      # RBAC check (admin)
│   │   ├── errorMiddleware.js     # Global error & 404 handler
│   │   └── validateMiddleware.js  # Request validation
│   ├── models/
│   │   ├── User.js
│   │   ├── Note.js
│   │   └── Post.js
│   ├── routes/
│   │   ├── authRoutes.js
│   │   ├── noteRoutes.js
│   │   ├── postRoutes.js
│   │   ├── adminRoutes.js
│   │   └── aggregationRoutes.js
│   ├── app.js                     # Express app definition
│   └── server.js                  # Local development server runner
├── vercel.json                    # Routing & serverless config
├── package.json
└── project-readme.md
```

### 8.2. Mongoose Connection Caching (`src/config/db.js`)
Serverless functions create new instances on cold starts. To prevent connection leaks and MongoDB Atlas connection exhaustion, the connection is cached across invocations:
```javascript
let cached = global.mongoose || { conn: null, promise: null };

export async function connectDB() {
  if (cached.conn) return cached.conn;
  if (!cached.promise) {
    cached.promise = mongoose.connect(process.env.MONGODB_URI, {
      bufferCommands: false,
    });
  }
  cached.conn = await cached.promise;
  global.mongoose = cached;
  return cached.conn;
}
```

### 8.3. `vercel.json` Configuration
```json
{
  "version": 2,
  "rewrites": [
    { "source": "/api/(.*)", "destination": "/api/index.js" },
    { "source": "/(.*)", "destination": "/public/$1" }
  ]
}
```

---

## 9. GitHub Actions CI/CD Configuration

### Required GitHub Repository Secrets
1. `VERCEL_TOKEN`: Personal access token generated from Vercel Account Settings.
2. `VERCEL_ORG_ID`: Vercel team/user organization ID.
3. `VERCEL_PROJECT_ID`: Vercel project ID linked to this repository.
4. `MONGODB_URI`: MongoDB Atlas connection string.
5. `JWT_SECRET`: Secret key for JWT signing.

### Workflows
- **`ci.yml`**: Triggers on pull requests and pushes to `main`. Installs dependencies, runs linting, and runs automated tests with an in-memory MongoDB runner (`mongodb-memory-server`).
- **`deploy.yml`**: Triggers on pushes to `main` when CI succeeds. Uses `amondnet/vercel-action` to build and deploy directly to Vercel production.

---

## 10. Local Development Setup

1. **Clone repository & install dependencies**:
   ```bash
   git clone https://github.com/rizve-ahamed-raihan/secure-notes-api.git
   cd secure-notes-api
   npm install
   ```
2. **Configure environment variables**:
   Create a `.env` file:
   ```env
   PORT=5000
   MONGODB_URI=mongodb+srv://<user>:<password>@cluster.mongodb.net/secure_notes?retryWrites=true&w=majority
   JWT_SECRET=super_secret_jwt_key_here
   JWT_EXPIRES_IN=7d
   ```
3. **Run development server**:
   ```bash
   npm run dev
   ```
4. **Access the application**:
   - Backend API: `http://localhost:5000/api`
   - Frontend: `http://localhost:5000/`
