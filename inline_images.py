
import base64
import os
import re

def get_base64(path):
    with open(path, 'rb') as f:
        return base64.b64encode(f.read()).decode('utf-8')

html_path = 'index.html'
logo_oxxo_path = 'logov.png'
logo_tam_path = 'PNG File (transparent background).png'

if os.path.exists(html_path):
    with open(html_path, 'r', encoding='utf-8') as f:
        html = f.read()
    
    # Get base64
    oxxo_b64 = f"data:image/png;base64,{get_base64(logo_oxxo_path)}"
    tam_b64 = f"data:image/png;base64,{get_base64(logo_tam_path)}"
    
    # Replace logov.png
    html = html.replace('src="logov.png"', f'src="{oxxo_b64}"')
    # Replace PNG File (transparent background).png
    html = html.replace('src="PNG File (transparent background).png"', f'src="{tam_b64}"')
    
    with open(html_path, 'w', encoding='utf-8') as f:
        f.write(html)
    print("Successfully inlined images into index.html")
else:
    print("index.html not found")
