# app/routers/workflow.py
"""
Workflow Test Router — Supervity Workflow Stream Proxy

Endpoint:
  POST /api/workflow/execute   Proxy multipart request to Supervity workflow stream API
"""

import logging
import os
from typing import Optional

import httpx
from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import StreamingResponse

log = logging.getLogger(__name__)
router = APIRouter(prefix="/workflow", tags=["Workflow"])

SUPERVITY_API_URL = os.getenv("SUPERVITY_API_URL", "https://auto-workflow-api.supervity.ai")
SUPERVITY_API_KEY = os.getenv("SUPERVITY_API_KEY", "")
WORKFLOW_ID = "019fe1b2-c4a1-7000-b71b-356296854d8f"


@router.post("/execute")
async def execute_workflow(
    customer_identifier: str = Form(...),
    customer_message: str = Form(...),
    membership_program_url: str = Form(...),
    tier_benefits_document: UploadFile = File(...),
):
    """
    Proxy a multipart form request to the Supervity workflow stream API.
    Streams the response back to the frontend in real-time.
    """
    if not SUPERVITY_API_KEY:
        raise HTTPException(
            status_code=500,
            detail="SUPERVITY_API_KEY is not configured in the environment.",
        )

    target_url = f"{SUPERVITY_API_URL}/api/v1/workflow-runs/execute/stream"

    # Read file content
    file_content = await tier_benefits_document.read()
    file_name = tier_benefits_document.filename or "document"

    log.info(
        "Proxying workflow request: customer=%s, file=%s (%d bytes)",
        customer_identifier,
        file_name,
        len(file_content),
    )

    # Build the multipart payload matching the Supervity API spec
    files_payload = {
        "workflowId": (None, WORKFLOW_ID),
        "inputs[customer_identifier]": (None, customer_identifier),
        "inputs[customer_message]": (None, customer_message),
        "inputs[membership_program_url]": (None, membership_program_url),
        "inputs[tier_benefits_document]": (
            file_name,
            file_content,
            tier_benefits_document.content_type or "application/octet-stream",
        ),
    }

    headers = {
        "Authorization": f"Bearer {SUPERVITY_API_KEY}",
        "x-source": "external",
        "x-active-org": "SubLife",
        "x-user-timezone": "Asia/Kuala_Lumpur",
    }

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(300.0)) as client:
            response = await client.post(
                target_url,
                files=files_payload,
                headers=headers,
            )

        log.info("Supervity API responded with status %d", response.status_code)

        if response.status_code != 200:
            log.error("Supervity API error: %s", response.text[:500])
            raise HTTPException(
                status_code=response.status_code,
                detail=f"Supervity API error: {response.text[:500]}",
            )

        # Return the response body with the same content type
        content_type = response.headers.get("content-type", "text/plain")

        return StreamingResponse(
            iter([response.content]),
            media_type=content_type,
            headers={"X-Supervity-Status": str(response.status_code)},
        )

    except httpx.TimeoutException:
        log.error("Supervity API request timed out")
        raise HTTPException(status_code=504, detail="Supervity API request timed out")
    except httpx.ConnectError as e:
        log.error("Failed to connect to Supervity API: %s", str(e))
        raise HTTPException(
            status_code=502,
            detail=f"Failed to connect to Supervity API: {str(e)}",
        )
    except HTTPException:
        raise
    except Exception as e:
        log.error("Unexpected error proxying workflow: %s", str(e))
        raise HTTPException(
            status_code=500,
            detail=f"Unexpected error: {str(e)}",
        )


@router.post("/execute/stream")
async def execute_workflow_stream(
    customer_identifier: str = Form(...),
    customer_message: str = Form(...),
    membership_program_url: str = Form(...),
    tier_benefits_document: UploadFile = File(...),
):
    """
    True streaming variant — streams the Supervity response chunk-by-chunk
    as a Server-Sent Events (SSE) style response.
    """
    if not SUPERVITY_API_KEY:
        raise HTTPException(
            status_code=500,
            detail="SUPERVITY_API_KEY is not configured in the environment.",
        )

    target_url = f"{SUPERVITY_API_URL}/api/v1/workflow-runs/execute/stream"

    file_content = await tier_benefits_document.read()
    file_name = tier_benefits_document.filename or "document"

    files_payload = {
        "workflowId": (None, WORKFLOW_ID),
        "inputs[customer_identifier]": (None, customer_identifier),
        "inputs[customer_message]": (None, customer_message),
        "inputs[membership_program_url]": (None, membership_program_url),
        "inputs[tier_benefits_document]": (
            file_name,
            file_content,
            tier_benefits_document.content_type or "application/octet-stream",
        ),
    }

    headers = {
        "Authorization": f"Bearer {SUPERVITY_API_KEY}",
        "x-source": "external",
        "x-active-org": "SubLife",
        "x-user-timezone": "Asia/Kuala_Lumpur",
    }

    async def stream_generator():
        async with httpx.AsyncClient(timeout=httpx.Timeout(300.0)) as client:
            async with client.stream(
                "POST",
                target_url,
                files=files_payload,
                headers=headers,
            ) as response:
                if response.status_code != 200:
                    error_body = await response.aread()
                    yield f"data: {{\"error\": true, \"status\": {response.status_code}, \"message\": \"{error_body.decode()[:300]}\"}}\n\n"
                    return

                async for chunk in response.aiter_bytes(chunk_size=1024):
                    if chunk:
                        yield chunk.decode("utf-8", errors="replace")

    return StreamingResponse(
        stream_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
