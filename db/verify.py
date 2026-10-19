"""
ConflictCore Database Verification Runner
Tests schema migration, seed ingestion, and executes CRUD & relational queries.
"""
import subprocess
import sys

MYSQL_USER = "root"
MYSQL_PASSWORD = "root"
DB_NAME = "conflictcore_db"

def run_cmd(args, stdin_file=None):
    cmd = ["mysql", f"-u{MYSQL_USER}", f"-p{MYSQL_PASSWORD}"]
    if stdin_file:
        with open(stdin_file, "r", encoding="utf-8") as f:
            content = f.read()
        res = subprocess.run(cmd + args, input=content, text=True, capture_output=True)
    else:
        res = subprocess.run(cmd + args, text=True, capture_output=True)
    return res

def main():
    print("==================================================")
    print("ConflictCore DBMS Verification")
    print("==================================================")

    # Optional Rebuild Flag check
    rebuild = "--rebuild" in sys.argv
    if rebuild:
        print("\n[Step 1] Applying migration: db/migrations/001_initial_schema.sql...")
        res = run_cmd([], stdin_file="db/migrations/001_initial_schema.sql")
        if res.returncode != 0:
            print(f"Error applying schema: {res.stderr}")
            sys.exit(1)
        print("Schema applied successfully.")

        print("\n[Step 2] Loading seed data: db/seeds/seed.sql...")
        res = run_cmd([DB_NAME], stdin_file="db/seeds/seed.sql")
        if res.returncode != 0:
            print(f"Error loading seed data: {res.stderr}")
            sys.exit(1)
        print("Seed data loaded successfully.")
    else:
        print("\n[Step 1] Validating existing database connection...")
        res = run_cmd(["-e", f"USE {DB_NAME}; SELECT DATABASE();"])
        if res.returncode != 0:
            print(f"Error connecting to database: {res.stderr}")
            sys.exit(1)
        print("Database connection verified.")

    # Check Tables
    print("\n[Step 2] Checking 7 core tables in database...")
    res = run_cmd(["-e", f"USE {DB_NAME}; SHOW TABLES;"])
    tables = [line.strip() for line in res.stdout.strip().splitlines() if line.strip() and not line.startswith("Tables_in")]
    print(f"Detected {len(tables)} tables: {', '.join(tables)}")
    expected_tables = {"users", "folders", "files", "file_permissions", "operations", "processes", "file_locks"}
    if not expected_tables.issubset(set(t.lower() for t in tables)):
        print(f"Missing expected tables! Found: {tables}")
        sys.exit(1)
    print("All 7 core tables confirmed!")

    # 4. Check Table Row Counts
    print("\n[Step 4] Checking table row counts...")
    count_query = (
        f"USE {DB_NAME}; "
        "SELECT 'USERS' AS tbl, count(*) AS cnt FROM USERS UNION ALL "
        "SELECT 'FOLDERS', count(*) FROM FOLDERS UNION ALL "
        "SELECT 'FILES', count(*) FROM FILES UNION ALL "
        "SELECT 'FILE_PERMISSIONS', count(*) FROM FILE_PERMISSIONS UNION ALL "
        "SELECT 'OPERATIONS', count(*) FROM OPERATIONS UNION ALL "
        "SELECT 'PROCESSES', count(*) FROM PROCESSES UNION ALL "
        "SELECT 'FILE_LOCKS', count(*) FROM FILE_LOCKS;"
    )
    res = run_cmd(["-e", count_query])
    print(res.stdout.strip())

    # 5. Run CRUD & Relational Test Queries
    print("\n[Step 5] Executing CRUD and relational test query suite...")
    res = run_cmd(["-t"], stdin_file="db/queries/crud_and_relational_tests.sql")
    if res.returncode != 0:
        print(f"Error in test queries: {res.stderr}")
        sys.exit(1)
    print("CRUD & Relational Queries executed with 0 errors!")
    print("\nVerification Complete: All DBMS verification requirements passed successfully.")

if __name__ == "__main__":
    main()
