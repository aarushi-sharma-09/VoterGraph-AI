# app/api/search.py
from fastapi import APIRouter, Query, HTTPException
from app.services.graph_service import get_neo4j_graph

router = APIRouter()

@router.get("/booth")
async def search_polling_booth(
    constituency_code: str = Query(...),
    polling_station_no: str | None = Query(None),
    name_filter: str | None = Query(None),
):
    """
    Deterministic Neo4j search for citizens registered at a specific polling station.
    Takes zero LLM dependencies; entirely parameterized Cypher.
    """
    graph = get_neo4j_graph()
    if graph is None:
        raise HTTPException(status_code=503, detail={"error": "GraphEngineUnavailable", "message": "Neo4j connection failed."})

    cypher = """
    MATCH (p:Person)-[:LIVES_IN]->(h:House)-[:BELONGS_TO]->(ps:PollingStation)
          -[:PART_OF]->(c:Constituency {code: $code})-[:LOCATED_IN]->(d:District)
          -[:LOCATED_IN]->(s:State)
    WHERE 1=1
    """
    params = {"code": constituency_code}
    
    if polling_station_no:
        cypher += " AND ps.number = $station"
        params["station"] = polling_station_no
        
    if name_filter:
        cypher += " AND toLower(p.name) CONTAINS toLower($name)"
        params["name"] = name_filter
        
    cypher += """
    OPTIONAL MATCH (p)-[:IS_SON_OF]->(father:Person)
    OPTIONAL MATCH (p)-[:IS_WIFE_OF]->(husband:Person)
    RETURN
        p.name AS elector_name,
        COALESCE(father.name, husband.name) AS relative_name,
        CASE WHEN father IS NOT NULL THEN 'Father'
             WHEN husband IS NOT NULL THEN 'Husband'
             ELSE NULL END AS relative_type,
        p.age AS age, p.gender AS gender, p.voter_id AS epic_number,
        p.part_serial_no AS part_serial_no, s.name AS state, d.name AS district,
        c.code AS ac_number, c.name AS ac_name, ps.number AS polling_station_no,
        ps.name AS polling_station_name, h.number AS house_number
    ORDER BY p.name LIMIT 100
    """

    try:
        results = graph.query(cypher, params=params)
        return {"results": results, "count": len(results)}
    except Exception as e:
        raise HTTPException(status_code=500, detail={"error": "QueryExecutionError", "message": str(e)})
