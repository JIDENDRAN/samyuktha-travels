.PHONY: run realtime install

# Run the Flask Web Application
run:
	python app.py

# Run the WhatsApp Realtime Server
realtime:
	node realtime/server.js

# Install Python and Node.js dependencies
install:
	pip install -r requirements.txt
	npm install
