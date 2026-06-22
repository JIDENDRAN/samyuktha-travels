import os
import sys

# Add the parent directory to the path so python can import app.py
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app import app
