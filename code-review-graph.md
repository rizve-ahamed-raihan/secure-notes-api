# Code Review & Architecture Graph

This document provides a comprehensive structural, security, database indexing, and CI/CD code review graph for the **Secure Note-Taking Application**. It serves as an evaluator's guide to verify architecture decisions, role-based access control, indexing efficiency, and pipeline logic.

---

## 1. System Architecture & Component Interaction Graph

```mermaid
flowchart TD
    subgraph ClientLayer["Frontend Layer (/public)"]
        UI["Functional Single Page Interface\n(HTML5 / CSS3 / Vanilla JS Fetch)"]
    end

    subgraph ServerlessGateway["Vercel Edge & Serverless Runtime"]
        RewriteRule["vercel.json URL Rewriter"]
        ServerlessHandler["api/index.js\n(Serverless Function Entry)"]
    end

    subgraph AppLayer["Express Application (/src)"]
        App["Express App (src/app.js)"]
        CorsHelmet["Security Middleware\n(cors, helmet, express.json)"]
        
        subgraph Routing["API Routers (/src/routes)"]
            AuthR["authRoutes (/api/auth)"]
            NoteR["noteRoutes (/api/notes)"]
            AdminR["adminRoutes (/api/admin)"]
            PostR["postRoutes (/api/posts)"]
            AggR["aggregationRoutes (/api/aggregations)"]
        end

        subgraph Guards["Middleware Guards (/src/middleware)"]
            AuthMW["authMiddleware\n(Verify JWT Token)"]
            AdminGuard["roleMiddleware\n(Enforce role === 'admin')"]
            OwnerGuard["Ownership Guard\n(doc.user == req.user._id)"]
            ErrMW["errorMiddleware\n(Centralized Error Handler)"]
        end

        subgraph Controllers["Controllers (/src/controllers)"]
            AuthC["authController"]
            NoteC["noteController"]
            AdminC["adminController"]
            PostC["postController"]
            AggC["aggregationController"]
        end

        subgraph DataAccess["Data Access & Caching (/src/config)"]
        ConnCache["Cached Mongoose Connection\n(src/config/db.js / global.mongoose)"]
        end
    end

    subgraph DatabaseLayer["MongoDB Atlas Database"]
        UserCol[("users Collection\nIndexes: email, interests, createdAt")]
        NoteCol[("notes Collection\nIndexes: user+createdAt, createdAt")]
        PostCol[("posts Collection\nIndexes: author+createdAt")]
    end

    UI -->|"HTTP API Calls"| RewriteRule
    RewriteRule -->|"/api/*"| ServerlessHandler
    RewriteRule -->|"Static Assets"| UI
    ServerlessHandler --> App
    App --> CorsHelmet
    CorsHelmet --> Routing

    AuthR --> AuthC
    NoteR --> AuthMW --> NoteC
    AdminR --> AuthMW --> AdminGuard --> AdminC
    PostR --> AuthMW --> PostC
    AggR --> AuthMW --> AggC

    NoteC --> OwnerGuard
    NoteC --> ConnCache
    AuthC --> ConnCache
    AdminC --> ConnCache
    PostC --> ConnCache
    AggC --> ConnCache

    App --> ErrMW

    ConnCache --> UserCol
    ConnCache --> NoteCol
    ConnCache --> PostCol
```

---

## 2. Authentication & RBAC Verification Decision Graph

```mermaid
flowchart TD
    Req["Incoming API Request"] --> HasHeader{"Authorization Header\n'Bearer <token>' present?"}

    HasHeader -- No --> IsPublicRoute{"Is Route Public?\n(Login / Register / Public Posts / Static UI)"}
    IsPublicRoute -- Yes --> ExecPublic["Execute Public Controller"]
    IsPublicRoute -- No --> Return401["Return 401 Unauthorized\n'No token provided'"]

    HasHeader -- Yes --> VerifyJWT{"Is JWT Valid\n& Not Expired?"}
    VerifyJWT -- No --> Return401B["Return 401 Unauthorized\n'Invalid or expired token'"]

    VerifyJWT -- Yes --> LoadUser{"Query User by decoded id\n(from cached session/DB)"}
    LoadUser -- User Not Found --> Return401C["Return 401 Unauthorized\n'User no longer exists'"]

    LoadUser -- User Found --> AttachReq["Attach req.user = user"]
    AttachReq --> CheckAdminReq{"Does Route Require\nAdmin Role?"}

    CheckAdminReq -- Yes --> IsAdmin{"req.user.role === 'admin'?"}
    IsAdmin -- No --> Return403["Return 403 Forbidden\n'Admin privilege required'"]
    IsAdmin -- Yes --> ExecAdmin["Execute Admin Controller"]

    CheckAdminReq -- No --> CheckOwnership{"Does Action Target\nSpecific Resource?"}
    CheckOwnership -- No --> ExecUser["Execute Standard User Controller\n(e.g., list own notes, create note)"]

    CheckOwnership -- Yes --> VerifyOwner{"resource.user == req.user._id\nOR req.user.role === 'admin'?"}
    VerifyOwner -- Yes --> ExecResource["Execute Resource Controller\n(Update / Delete / View)"]
    VerifyOwner -- No --> Return403B["Return 403 Forbidden\n'Not authorized to access this resource'"]
```

---

## 3. Database Indexing & Query Optimization Graph (ESR Compliance)

> **Interview Evaluation Requirement**: Only strictly necessary indexes; zero redundancy; explicit `schema.index()` declaration.

```mermaid
classDiagram
    class UserModel {
        +ObjectId _id [Default Index]
        +String email [Unique Index]
        +String[] interests [Multikey Index]
        +Date createdAt [Sort Index]
        +String role
        +String password
    }

    class NoteModel {
        +ObjectId _id [Default Index]
        +ObjectId user [Compound Index Prefix]
        +Date createdAt [Compound Index Suffix & Standalone]
        +String title
        +String content
    }

    class PostModel {
        +ObjectId _id [Default Index]
        +ObjectId author [Compound Index Prefix]
        +Date createdAt [Compound Index Suffix]
        +String title
        +String content
    }

    UserModel -- NoteModel : 1 to Many
    UserModel -- PostModel : 1 to Many
```

### Index Evaluation Matrix & ESR Justification

```mermaid
flowchart LR
    subgraph QueryPatterns["Query Patterns"]
        Q1["User Login / Registration\nUser.findOne({ email })"]
        Q2["List User Notes (Paginated)\nNote.find({ user }).sort({ createdAt: -1 })"]
        Q3["Admin List All Notes\nNote.find().sort({ createdAt: -1 })"]
        Q4["Admin List All Users\nUser.find().sort({ createdAt: -1 })"]
        Q5["Scenario 1 Aggregation\nUser.aggregate([{ $unwind: '$interests' }, ...])"]
        Q6["Scenario 2 Aggregation ($lookup)\nUser.aggregate([{ $lookup: { from: 'posts', ... } }])"]
    end

    subgraph Indexes["Declared Minimal Indexes"]
        I1["User: { email: 1 } (unique: true)"]
        I2["Note: { user: 1, createdAt: -1 }"]
        I3["Note: { createdAt: -1 }"]
        I4["User: { createdAt: -1 }"]
        I5["User: { interests: 1 }"]
        I6["Post: { author: 1, createdAt: -1 }"]
    end

    Q1 -->|"Equality (E)"| I1
    Q2 -->|"Equality (E) + Sort (S)"| I2
    Q3 -->|"Sort (S)"| I3
    Q4 -->|"Sort (S)"| I4
    Q5 -->|"Multikey Scan"| I5
    Q6 -->|"foreignField Lookup Match"| I6
```

### Why No Redundant Indexes Exist
1. **No `{ user: 1 }` on `Note`**: Any query filtering strictly by `{ user: userId }` utilizes the left prefix of `{ user: 1, createdAt: -1 }`. Creating `{ user: 1 }` would be redundant.
2. **No `{ author: 1 }` on `Post`**: The compound index `{ author: 1, createdAt: -1 }` covers all equality lookups on `author` during `$lookup`.
3. **No separate index for `_id`**: MongoDB automatically manages a unique B-tree index on `_id` across all collections.

---

## 4. Aggregation Pipelines Execution Graph

### Scenario 1: Group by Interests Pipeline

```mermaid
flowchart TD
    Step1["Input: User Collection Documents\n[ { name: 'Alice', interests: ['chess', 'reading'] }, ... ]"]
    --> Step2["$unwind: '$interests'\nFlattens array into individual documents\n[ { name: 'Alice', interests: 'chess' }, { name: 'Alice', interests: 'reading' } ]"]
    --> Step3["$group: { _id: '$interests', totalUsers: { $sum: 1 }, users: { $push: ... } }\nGroups documents by unique interest value"]
    --> Step4["$sort: { _id: 1 }\nSorts interest keys in alphabetical order"]
    --> Output1["Output: Grouped Interest Catalog\n[ { _id: 'chess', totalUsers: 3, users: [...] }, { _id: 'reading', totalUsers: 5, ... } ]"]
```

### Scenario 2: User Posts `$lookup` Pipeline

```mermaid
flowchart TD
    Step2_1["Target userId: ObjectId('...')"]
    --> Step2_2["$match: { _id: targetUserId }\nFast O(1) indexed lookup on User._id"]
    --> Step2_3["$lookup:\nfrom: 'posts'\nlocalField: '_id'\nforeignField: 'author'\nas: 'posts'\n(Accelerated by Post index: { author: 1, createdAt: -1 })"]
    --> Step2_4["$project:\n{ password: 0, __v: 0 }\nStrips sensitive credentials before returning"]
    --> Output2["Output: Combined User Profile with Array of Authored Posts"]
```

---

## 5. Serverless Lifecycle & Database Connection Cache Graph

```mermaid
sequenceDiagram
    autonumber
    actor Client
    participant Vercel as Vercel Edge / Rewrite
    participant Lambda as Serverless Function (api/index.js)
    participant Cache as global.mongoose Cache
    participant Atlas as MongoDB Atlas

    Client->>Vercel: HTTP GET /api/notes
    Vercel->>Lambda: Forward Request to Serverless Instance
    Lambda->>Cache: Check cached connection (cached.conn)
    alt Cold Start (No active connection)
        Cache-->>Lambda: null
        Lambda->>Atlas: mongoose.connect(MONGODB_URI, bufferCommands: false)
        Atlas-->>Lambda: Connection Established
        Lambda->>Cache: Save conn & promise in global.mongoose
    else Warm Invocation (Reused instance)
        Cache-->>Lambda: Return active cached connection
    end
    Lambda->>Atlas: Execute Indexed Query (find / aggregate)
    Atlas-->>Lambda: Return Documents
    Lambda-->>Vercel: HTTP 200 JSON Response
    Vercel-->>Client: Render JSON data
```

---

## 6. CI/CD Code Review & Automated Deployment Pipeline

```mermaid
flowchart TD
    subgraph Developer["Development Flow"]
        CodeChange["Git Commit & Push to main / PR"]
    end

    subgraph GitHubActions["GitHub Actions Automation (.github/workflows)"]
        subgraph CIWorkflow["ci.yml (Continuous Integration)"]
            Checkout["actions/checkout@v4"]
            SetupNode["actions/setup-node@v4 (Node 20.x, cache: npm)"]
            NpmCI["npm ci"]
            LintCheck["ESLint / Code Syntax Verification"]
            TestRunner["Jest API Test Suite with MongoMemoryServer"]
            RBACVerify["Verify RBAC (Admin vs User restrictions)"]
            IndexVerify["Verify schema.index Declarations"]
            AggVerify["Verify Aggregation Pipeline Outputs"]
        end

        subgraph CDWorkflow["deploy.yml (Continuous Deployment)"]
            VercelDeploy["amondnet/vercel-action\n(Deploy to Vercel Production)"]
            NotifySuccess["Deployment Live Status URL"]
        end
    end

    subgraph Production["Production Environment"]
        VercelProd["Vercel Production Application Live\n(https://your-project.vercel.app)"]
    end

    CodeChange --> Checkout
    Checkout --> SetupNode --> NpmCI
    NpmCI --> LintCheck --> TestRunner
    TestRunner --> RBACVerify
    TestRunner --> IndexVerify
    TestRunner --> AggVerify

    IndexVerify -->|"All Tests Pass on main Branch"| VercelDeploy
    VercelDeploy --> NotifySuccess --> VercelProd
```

---

## 7. Reviewer Verification Checklist

| Review Dimension | Expected Code Quality | Verification Method |
| :--- | :--- | :--- |
| **Index Visibility** | Uses `schema.index()` explicitly for all indexes. | Inspect `src/models/*.js`. Automated in test suite. |
| **Index Minimalism** | Zero duplicate/redundant prefix indexes. | Audit against ESR matrix in Section 3. |
| **RBAC Security** | Strict separation: standard user cannot view other users' notes or hit admin routes. | Execute `test/rbac.test.js`. |
| **Aggregation Constraints** | Exactly one `.aggregate()` call for Scenario 1; Single `$lookup` pipeline for Scenario 2. | Inspect `src/controllers/aggregationController.js`. |
| **Serverless Hygiene** | DB connection cached in global scope; prevents Atlas connection leak. | Inspect `src/config/db.js`. |
| **Frontend Simplicity** | Vanilla HTML/CSS/JS without heavyweight boilerplate/frameworks. | Inspect `public/index.html` & `public/app.js`. |
| **CI/CD Readiness** | CI passes test suite before CD triggers Vercel deployment. | Inspect `.github/workflows/ci.yml` & `deploy.yml`. |
