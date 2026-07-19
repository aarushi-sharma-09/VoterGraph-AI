import os
from dotenv import load_dotenv
from neo4j import GraphDatabase

load_dotenv("ms2-agent/.env")

uri = os.getenv("NEO4J_URI")
user = os.getenv("NEO4J_USERNAME")
password = os.getenv("NEO4J_PASSWORD")

driver = GraphDatabase.driver(uri, auth=(user, password))

def run_query():
    with driver.session() as session:
        # Get a father with sons to test complex lineage
        res = session.run("""
            MATCH (f:Person)-[:IS_SON_OF]->(gf:Person)-[:LIVES_IN]->(h:House)-[:BELONGS_TO]->(ps:PollingStation {number: '101'})
            RETURN gf.name AS father, f.name AS son, h.number AS house
            LIMIT 1
        """)
        record = res.single()
        if record:
            print(f"Father/Son: {record['father']} -> {record['son']}, House: {record['house']}")
        
        # Get a couple
        res2 = session.run("""
            MATCH (w:Person)-[:IS_WIFE_OF]->(h:Person)-[:LIVES_IN]->(house:House)-[:BELONGS_TO]->(ps:PollingStation {number: '101'})
            RETURN w.name AS wife, h.name AS husband, house.number AS house
            LIMIT 1
        """)
        record2 = res2.single()
        if record2:
            print(f"Husband/Wife: {record2['husband']} -> {record2['wife']}, House: {record2['house']}")

        # Get general
        res3 = session.run("""
            MATCH (p:Person)-[:LIVES_IN]->(h:House)-[:BELONGS_TO]->(ps:PollingStation {number: '102'})
            RETURN p.name AS name, h.number AS house
            LIMIT 1
        """)
        record3 = res3.single()
        if record3:
            print(f"Station 102 Person: {record3['name']}, House: {record3['house']}")

run_query()
driver.close()
