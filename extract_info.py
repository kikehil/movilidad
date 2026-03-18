import pandas as pd
import json
import sys

try:
    df = pd.read_excel('Formato FCE Puestos Tipo 2026 Asesor TI.xlsx')
    indicators = [
        'Operación Resiliente', 
        'Cumplimiento STP', 
        'Telco Tienda/Oficina', 
        'Renovación tecnológica', 
        'Mejora NPS', 
        'AIOps', 
        'Capitanías TI'
    ]
    results = {}
    
    # Fill NaN to avoid errors during string join
    df = df.fillna('')
    
    for _, row in df.iterrows():
        row_str = ' '.join([str(v) for v in row.values])
        for ind in indicators:
            if ind.lower() in row_str.lower():
                # Store the whole row as info for now
                if ind not in results:
                    results[ind] = []
                results[ind].append(row_str)
                
    with open('extracted_indicators.json', 'w', encoding='utf-8') as f:
        json.dump(results, f, indent=2, ensure_ascii=False)
    print("Extraction successful")
    
except Exception as e:
    print(f"Error: {e}")
    sys.exit(1)
