# Offline asset-authoring tool only. Never installed in the API or browser image.
FROM python:3.11-slim-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends libx11-6 libxrender1 libxi6 libxfixes3 libxkbcommon0 libsm6 libgl1 libegl1 libgomp1 && rm -rf /var/lib/apt/lists/*
RUN python -m pip install --no-cache-dir bpy==4.5.15
WORKDIR /tools
COPY scripts/equipment/convert_openusd.py /tools/convert_openusd.py
ENTRYPOINT ["python", "/tools/convert_openusd.py"]
