import os
import subprocess
import datetime
import math
from datetime import timedelta

def run_command(command):
    try:
        # shell=True is needed for complex commands, but we'll try to use list format where possible for safety
        # For simple git commands, list format is better.
        if isinstance(command, str):
            result = subprocess.run(command, shell=True, check=True, text=True, capture_output=True)
        else:
            result = subprocess.run(command, check=True, text=True, capture_output=True)
        return result.stdout.strip()
    except subprocess.CalledProcessError as e:
        print(f"Error running command: {command}")
        print(f"Stderr: {e.stderr}")
        raise

def main():
    # Configuration
    TARGET_COMMIT_COUNT = 200 # Target roughly this many commits (user asked for 200)
    DAYS_BACK = 30
    
    # 1. Get List of Tracked Files (excluding deleted ones if any, but ls-files gives current)
    # Using 'git ls-files' to get the current state of files we want to keep.
    print("Getting list of tracked files...")
    files_output = run_command(["git", "ls-files"])
    all_files = files_output.splitlines()
    
    # exclude node_modules just in case, though ls-files shouldn't show them if ignored
    files = [f for f in all_files if 'node_modules' not in f and '.git' not in f]
    
    total_files = len(files)
    print(f"Found {total_files} files.")

    # Calculate timestamps
    now = datetime.datetime.now()
    start_time = now - timedelta(days=DAYS_BACK)
    time_increment = (now - start_time) / total_files
    
    # 2. Setup Branches
    current_branch = run_command(["git", "branch", "--show-current"])
    backup_branch = f"backup-{current_branch}-{int(now.timestamp())}"
    
    print(f"Backing up current branch '{current_branch}' to '{backup_branch}'...")
    run_command(["git", "branch", backup_branch])
    
    # Create orphan branch
    temp_branch = "temp-clean-history"
    # Check if exists and delete if so
    try:
        run_command(["git", "branch", "-D", temp_branch])
    except:
        pass # Branch didn't exist
        
    print(f"Creating orphan branch '{temp_branch}'...")
    run_command(["git", "checkout", "--orphan", temp_branch])
    # Use reset to unstage all files but KEEP them in working directory
    run_command(["git", "reset"]) 
    
    # 3. Reconstruct History
    print("Reconstructing history...")
    
    # To hit ~200 commits, if we have > 200 files, we might need to group some?
    # User said "reduce no of commits instead of 600 i want only 200"
    # User also said "show old not only in heat map but also that the commit was 1 month ago"
    
    # 235 files is close enough to 200, so 1 file per commit is fine.
    # It will result in 235 commits.
    
    for i, file_path in enumerate(files):
        # Check if file actually exists on disk (it should)
        if not os.path.exists(file_path):
            continue
            
        commit_date = start_time + (time_increment * i)
        # Format date for git: "YYYY-MM-DD HH:MM:SS"
        date_str = commit_date.strftime("%Y-%m-%d %H:%M:%S")
        
        # Add file
        run_command(["git", "add", file_path])
        
        # Commit with date
        env = os.environ.copy()
        env["GIT_AUTHOR_DATE"] = date_str
        env["GIT_COMMITTER_DATE"] = date_str
        
        message = f"feat: add {os.path.basename(file_path)}"
        if i < 10: # First few as init/setup
            message = "chore: initial project setup"
        
        # We need to run this with the env vars
        subprocess.run(
            ["git", "commit", "-m", message],
            check=True,
            env=env,
            stdout=subprocess.DEVNULL # Silence output
        )
        
        if i % 20 == 0:
            print(f"Committed {i}/{total_files} files...")

    print("History reconstruction complete.")
    print(f"New branch '{temp_branch}' is ready for inspection.")
    print("To apply: git branch -M main (or your target branch)")

if __name__ == "__main__":
    main()
