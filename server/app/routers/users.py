import uuid
import logging
from fastapi import APIRouter, Request
from app.schemas import UserRegister, UserResponse
from app.services import storage

router = APIRouter(prefix="/users", tags=["users"])
logger = logging.getLogger(__name__)


@router.post("/register", response_model=UserResponse)
async def register_user(request: Request, payload: UserRegister):
    user_id = str(uuid.uuid4())
    user = {
        "id":   user_id,
        "ip":   request.client.host,
        "port": request.client.port,
    }
    storage.upsert_user(user)
    logger.info(f"[users] Registered {user_id} from {user['ip']}:{user['port']}")
    return {"user_id": user_id}
