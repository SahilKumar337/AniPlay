from pydantic import BaseModel, Field
from typing import List, Optional

class Subtitle(BaseModel):
    id: int
    label: str
    file: str

class Server(BaseModel):
    name: str
    videoUrl: str
    type: str = "sub"  # "sub" or "dub"
    subtitles: List[Subtitle] = Field(default_factory=list)
    isHLS: Optional[bool] = None

class AnimeServersResponse(BaseModel):
    ok: bool
    servers: List[Server]
    animeTitle: str
    slug: str
    isPartial: bool

class ErrorResponse(BaseModel):
    ok: bool = False
    error: str
