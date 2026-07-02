from cachetools import TTLCache

# In-memory TTL caches
# Caches search queries for 2 hours (max 1000 items)
search_cache = TTLCache(maxsize=1000, ttl=7200)

# Caches episode lists for 2 hours (max 1000 items)
episode_cache = TTLCache(maxsize=1000, ttl=7200)

# Caches parsed/resolved server listings for 30 minutes (max 1000 items)
server_cache = TTLCache(maxsize=1000, ttl=1800)

# Caches resolved embed stream URLs (e.g. m3u8 links parsed from iframe) for 10 minutes (max 1000 items)
stream_cache = TTLCache(maxsize=1000, ttl=600)
