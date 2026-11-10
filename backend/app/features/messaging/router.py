"""Human chat REST endpoints and scoped Socket.IO ticket issuance."""

from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import JSONResponse
from app.infrastructure.database import get_db
from app.core.security import current_user
from . import service

router = APIRouter(prefix="/api", tags=["Messaging"])


@router.get("/doctorpatientrelations")
async def list_relations(userId: str, role: str, user=Depends(current_user), db=Depends(get_db)):
    return await service.list_relations(userId, role, user, db)


@router.post("/doctorpatientrelations")
async def create_relation(
    request: Request, response: Response, user=Depends(current_user), db=Depends(get_db)
):
    result = await service.create_or_get_relation(await request.json(), user, db)
    response.status_code = 201 if result["isNew"] else 200
    return result


@router.get("/doctorpatientrelations/{relationId}/chats")
async def list_messages(
    relationId: str,
    page: int = 1,
    limit: int = 50,
    order: str = "desc",
    user=Depends(current_user),
    db=Depends(get_db),
):
    return await service.list_messages(relationId, page, limit, order, user, db)


@router.post("/doctorpatientrelations/{relationId}/chats")
async def send_message(
    relationId: str, request: Request, response: Response, user=Depends(current_user), db=Depends(get_db)
):
    result, duplicate = await service.send_rest_message(relationId, await request.json(), user, db)
    response.status_code = 200 if duplicate else 201
    return result


@router.get("/socket/token")
@router.post("/socket/token")
async def issue_socket_ticket(request: Request, user=Depends(current_user), db=Depends(get_db)):
    relation_id = request.query_params.get("relationId")
    if request.method == "POST":
        try:
            body = await request.json()
            relation_id = body.get("relationId") or relation_id
        except ValueError:
            pass
    payload = await service.issue_socket_ticket(relation_id, user, db)
    return JSONResponse(
        payload,
        headers={
            "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
            "Pragma": "no-cache",
            "Expires": "0",
        },
    )
