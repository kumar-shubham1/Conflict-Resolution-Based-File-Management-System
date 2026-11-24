
"""
ConflictCore Database Verification Runner
Tests schema migration, seed ingestion, and executes CRUD & relational queries.
"""

import os
import subprocess
import sys
from pathlib import Path
from dotenv import load_dotenv

# --------------------------------------------------
# PROJECT PATHS
# --------------------------------------------------

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent
DB_DIR = PROJECT_ROOT / "db"

ENV_FILE = PROJECT_ROOT / ".env"
load_dotenv(dotenv_path=ENV_FILE)

# Load backend/.env
if not ENV_FILE.exists():
    print(f"Error: Environment file not found: {ENV_FILE}")
    sys.exit(1)

load_dotenv(dotenv_path=ENV_FILE)

# --------------------------------------------------
# DATABASE CONFIGURATION
# --------------------------------------------------

MYSQL_USER = os.getenv("DB_USER", "root")
MYSQL_PASSWORD = os.getenv("DB_PASSWORD")
DB_NAME = os.getenv("DB_NAME", "conflictcore_db")
DB_HOST = os.getenv("DB_HOST", "localhost")
DB_PORT = os.getenv("DB_PORT", "3306")

SCHEMA_FILE = DB_DIR / "migrations" / "001_initial_schema.sql"
SEED_FILE = DB_DIR / "seeds" / "seed.sql"
TEST_FILE = DB_DIR / "queries" / "crud_and_relational_tests.sql"



# --------------------------------------------------
# MYSQL COMMAND RUNNER
# --------------------------------------------------

def run_cmd(args, stdin_file=None):

    cmd = [
        "mysql",
        f"-h{DB_HOST}",
        f"-P{DB_PORT}",
        f"-u{MYSQL_USER}",
        "--default-character-set=utf8mb4"
    ]

    # MYSQL_PWD avoids putting the password in the
    # command-line arguments. Use only for local development:
    # MySQL documents this environment variable as insecure.
    env = os.environ.copy()

    if MYSQL_PASSWORD is not None:
        env["MYSQL_PWD"] = MYSQL_PASSWORD

    try:
        if stdin_file:
            with open(stdin_file, "r", encoding="utf-8") as f:
                content = f.read()

            return subprocess.run(
                cmd + args,
                input=content,
                text=True,
                capture_output=True,
                env=env
            )

        return subprocess.run(
            cmd + args,
            text=True,
            capture_output=True,
            env=env
        )

    except FileNotFoundError:
        print("Error: MySQL command-line client was not found.")
        print("Make sure MySQL is installed and its bin directory is in PATH.")
        sys.exit(1)

    except OSError as error:
        print(f"Command execution error: {error}")
        sys.exit(1)


# --------------------------------------------------
# ERROR HANDLER
# --------------------------------------------------

def check_result(res, message):

    if res.returncode != 0:
        print(f"\n{message}")

        if res.stderr:
            print(res.stderr)

        if res.stdout:
            print(res.stdout)

        sys.exit(1)


# --------------------------------------------------
# MAIN VERIFICATION
# --------------------------------------------------

def main():

    print("==================================================")
    print("       ConflictCore DBMS Verification")
    print("==================================================")

    if not MYSQL_PASSWORD:
        print("\nError: DB_PASSWORD environment variable is not set.")
        print("Please configure DB_USER, DB_PASSWORD, and DB_NAME.")
        sys.exit(1)

    if not DB_NAME.replace("_", "").isalnum():
        print("\nError: Invalid database name.")
        sys.exit(1)

    # --------------------------------------------------
    # STEP 1: REBUILD OR CONNECT
    # --------------------------------------------------

    rebuild = "--rebuild" in sys.argv

    if rebuild:

        print("\n[Step 1] Applying initial database schema...")

        if not SCHEMA_FILE.exists():
            print(f"Schema file not found: {SCHEMA_FILE}")
            sys.exit(1)

        res = run_cmd([], stdin_file=SCHEMA_FILE)
        check_result(res, "Error applying schema:")

        print("Initial schema applied successfully.")

        print("\n[Step 2] Loading seed data...")

        if not SEED_FILE.exists():
            print(f"Seed file not found: {SEED_FILE}")
            sys.exit(1)

        res = run_cmd([DB_NAME], stdin_file=SEED_FILE)
        check_result(res, "Error loading seed data:")

        print("Seed data loaded successfully.")

        print("\nIMPORTANT: Run migration 002_add_versions_conflicts.js")
        print("separately if the initial schema does not create the")
        print("FILE_VERSIONS and CONFLICTS tables.")

    else:

        print("\n[Step 1] Validating existing database connection...")

        res = run_cmd([
            DB_NAME,
            "-e",
            "SELECT DATABASE();"
        ])

        check_result(res, "Error connecting to database:")

        print("Database connection verified.")

    # --------------------------------------------------
    # STEP 3: CHECK TABLES
    # --------------------------------------------------

    print("\n[Step 3] Checking 9 required database tables...")

    res = run_cmd([
        DB_NAME,
        "-e",
        "SHOW TABLES;"
    ])

    check_result(res, "Error retrieving database tables:")

    tables = [
        line.strip()
        for line in res.stdout.strip().splitlines()
        if line.strip() and not line.startswith("Tables_in")
    ]

    detected_tables = {table.lower() for table in tables}

    expected_tables = {
        "users",
        "folders",
        "files",
        "file_permissions",
        "file_versions",
        "conflicts",
        "operations",
        "processes",
        "file_locks"
    }

    print(f"Detected {len(tables)} tables:")
    print(", ".join(tables))

    missing_tables = expected_tables - detected_tables

    if missing_tables:
        print("\nMissing required tables:")
        for table in sorted(missing_tables):
            print(f"- {table}")

        print("\nPlease apply the missing database migration.")
        sys.exit(1)

    print("\nAll 9 required tables confirmed!")

    # --------------------------------------------------
    # STEP 4: CHECK TABLE ROW COUNTS
    # --------------------------------------------------

    print("\n[Step 4] Checking table row counts...")

    count_query = """
        SELECT 'USERS' AS tbl, COUNT(*) AS cnt FROM USERS
        UNION ALL
        SELECT 'FOLDERS', COUNT(*) FROM FOLDERS
        UNION ALL
        SELECT 'FILES', COUNT(*) FROM FILES
        UNION ALL
        SELECT 'FILE_PERMISSIONS', COUNT(*) FROM FILE_PERMISSIONS
        UNION ALL
        SELECT 'FILE_VERSIONS', COUNT(*) FROM FILE_VERSIONS
        UNION ALL
        SELECT 'CONFLICTS', COUNT(*) FROM CONFLICTS
        UNION ALL
        SELECT 'OPERATIONS', COUNT(*) FROM OPERATIONS
        UNION ALL
        SELECT 'PROCESSES', COUNT(*) FROM PROCESSES
        UNION ALL
        SELECT 'FILE_LOCKS', COUNT(*) FROM FILE_LOCKS;
    """

    res = run_cmd([
        DB_NAME,
        "-e",
        count_query
    ])

    check_result(res, "Error checking table row counts:")

    print(res.stdout.strip())

    # --------------------------------------------------
    # STEP 5: CRUD AND RELATIONAL TESTS
    # --------------------------------------------------

    print("\n[Step 5] Executing CRUD and relational test queries...")

    if not TEST_FILE.exists():
        print(f"Test query file not found: {TEST_FILE}")
        sys.exit(1)

    res = run_cmd(
        [DB_NAME, "-t"],
        stdin_file=TEST_FILE
    )

    check_result(res, "Error executing CRUD test queries:")

    print(res.stdout.strip())
    print("\nCRUD and relational queries executed successfully!")

    # --------------------------------------------------
    # FINAL RESULT
    # --------------------------------------------------

    print("\n==================================================")
    print("VERIFICATION COMPLETED SUCCESSFULLY")
    print("All required DBMS verification checks passed.")
    print("==================================================")


if __name__ == "__main__":
    main()
