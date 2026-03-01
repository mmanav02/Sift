# Run the project

## Server (backend)

```bash
cd server
python3 -m venv venv
source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

## Client (React Native)

```bash
cd Client
npm install
npm start
```

In another terminal (with Metro still running):

```bash
cd Client
npm run android   # or: npm run ios
```
