import json
import psycopg2
from psycopg2.extras import RealDictCursor
import redis
from datetime import datetime
from backend.python.config import DB_CONN_STR, REDIS_URL

r = redis.Redis.from_url(REDIS_URL)

def publish_pending_documents():
    """
    Queries Postgres for PENDING staging data and pushes it to Redis.
    """
    total_queued = 0
    queue_name = "company_brain:ingest"

    conn = psycopg2.connect(DB_CONN_STR)
    cursor = conn.cursor(cursor_factory=RealDictCursor)
    
    try:
        #  HARVEST CUSTOM DOCUMENTS
        cursor.execute(
            'SELECT id, "externalId", "rawPayload", "createdAt" FROM "CustomDocument" WHERE status = \'PENDING\' LIMIT 100;'
        )
        custom_docs = cursor.fetchall()
        
        for doc in custom_docs:
            payload = {
                "id": doc["id"],
                "source": "CUSTOM",
                "content": json.dumps(doc["rawPayload"]),
                "metadata": {
                    "title": f"Custom Doc {doc['externalId']}",
                    "timestamp": doc["createdAt"].isoformat() if isinstance(doc["createdAt"], datetime) else str(doc["createdAt"])
                }
            }
            
            # Atomic Pipeline: Push onto Redis queue list

            
            r.lpush(queue_name, json.dumps(payload))
            
            # Update Postgres status to QUEUED
            cursor.execute(
                'UPDATE "CustomDocument" SET status = \'QUEUED\', "queuedAt" = %s WHERE id = %s;',
                (datetime.utcnow(), doc["id"])
            )
            total_queued += 1

        # HARVEST NOTION PAGES
        cursor.execute(
            'SELECT id, title, "plainText", url, "syncedAt" FROM "NotionPage" WHERE status = \'PENDING\' LIMIT 100;'
        )
        notion_pages = cursor.fetchall()
        
        for page in notion_pages:
            payload = {
                "id": page["id"],
                "source": "NOTION",
                "content": page["plainText"] or "",
                "metadata": {
                    "title": page["title"],
                    "url": page["url"],
                    "timestamp": page["syncedAt"].isoformat() if isinstance(page["syncedAt"], datetime) else str(page["syncedAt"])
                }
            }
            
            r.lpush(queue_name, json.dumps(payload))
            cursor.execute(
                'UPDATE "NotionPage" SET status = \'QUEUED\', "queuedAt" = %s WHERE id = %s;',
                (datetime.utcnow(), page["id"])
            )
            total_queued += 1
            
        # Commit changes to database
        conn.commit()
        print(f" Successfully queued {total_queued} documents into Redis.")
        return total_queued
        
    except Exception as e:
        conn.rollback()
        print(f" Error during pipeline flush: {e}")
        raise e
    finally:
        cursor.close()
        conn.close()