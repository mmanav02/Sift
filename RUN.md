# Run the project

## Server (backend)

```bash
cd server
python3 -m venv venv
source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

**If clients connect to a remote server (e.g. droplet at `165.245.139.104`):**  
- Use the same port in the client `CENTRAL_SERVER_URL` (e.g. `http://165.245.139.104:8001` if you run uvicorn with `--port 8001`).  
- **Open that port on the server** so phones/apps can reach it:
  - **UFW (Linux):** `sudo ufw allow 8001 && sudo ufw reload` (use your actual port).
  - **Cloud security group / firewall:** Allow inbound TCP on the same port (e.g. 8001).

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
