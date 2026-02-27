import os
import subprocess
import datetime
import random
from datetime import timedelta

def run_command(command, cwd=None):
    try:
        subprocess.run(command, check=True, cwd=cwd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except subprocess.CalledProcessError:
        print(f"Error executing: {' '.join(command)}")

def main():
    # Configuration
    REPO_NAME = "heatmap_repo"
    DAYS_BACK = 180 # 6 months
    MAX_COMMITS_PER_DAY = 8
    
    # 1. Create Repository Directory
    if not os.path.exists(REPO_NAME):
        os.makedirs(REPO_NAME)
    
    print(f"Initializing repository in {REPO_NAME}...")
    run_command(["git", "init"], cwd=REPO_NAME)
    
    # 2. Iterate over the last 6 months
    start_date = datetime.datetime.now() - timedelta(days=DAYS_BACK)
    
    total_commits = 0
    
    print("Generating commits (this may take a few seconds)...")
    for day_offset in range(DAYS_BACK + 1):
        current_date = start_date + timedelta(days=day_offset)
        
        # Randomly decide how many commits for this day
        # Weight towards 0 or 1-3 to look normal, occasional spikes
        r = random.random()
        if r < 0.3: num_commits = 0 # 30% chance of no commits
        elif r < 0.6: num_commits = random.randint(1, 3)
        elif r < 0.9: num_commits = random.randint(4, 6)
        else: num_commits = random.randint(7, MAX_COMMITS_PER_DAY)
        
        for i in range(num_commits):
            # Spread commits out over the day (9am - 11pm)
            hour = random.randint(9, 23)
            minute = random.randint(0, 59)
            second = random.randint(0, 59)
            
            commit_date = current_date.replace(hour=hour, minute=minute, second=second)
            date_str = commit_date.strftime("%Y-%m-%d %H:%M:%S")
            
            # Create a dummy change
            file_name = "data.txt"
            file_path = os.path.join(REPO_NAME, file_name)
            
            with open(file_path, "a") as f:
                f.write(f"Commit at {date_str}\n")
                
            # Commit with backdated timestamp
            env = os.environ.copy()
            env["GIT_AUTHOR_DATE"] = date_str
            env["GIT_COMMITTER_DATE"] = date_str
            
            subprocess.run(
                ["git", "add", file_name],
                check=True,
                cwd=REPO_NAME,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL
            )
            
            subprocess.run(
                ["git", "commit", "-m", f"update data {total_commits}"],
                check=True,
                env=env,
                cwd=REPO_NAME,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL
            )
            
            total_commits += 1
            
    print(f"Success! Generated {total_commits} commits over the last {DAYS_BACK} days.")
    print(f"Repository location: {os.path.abspath(REPO_NAME)}")
    print("\nNext Steps:")
    print("1. Create a new PRIVATE repository on GitHub (e.g., 'activity-log').")
    print(f"2. cd {REPO_NAME}")
    print("3. git remote add origin <your-new-repo-url>")
    print("4. git push -u origin main")

if __name__ == "__main__":
    main()
