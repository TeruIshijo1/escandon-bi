import os
import math
from datetime import date, timedelta
import psycopg2
import pandas as pd
import numpy as np
from dotenv import load_dotenv
import joblib

def main():
    print("=== Iniciando Predicción de Riesgo de Desabasto ===")

    # Cargar variables de entorno del archivo .env de backend
    base_dir = os.path.dirname(os.path.abspath(__file__))
    dotenv_path = os.path.join(base_dir, '..', '.env')
    load_dotenv(dotenv_path)

    # Cargar modelo joblib entrenado
    model_path = os.path.join(base_dir, 'models', 'reorder_risk_7d.joblib')
    if not os.path.exists(model_path):
        print(f"❌ Error: No se encontró el modelo entrenado en {model_path}.")
        print("Por favor corre train_reorder_risk.py primero.")
        return

    print(f"[Predict] Cargando modelo desde {model_path}...")
    model_data = joblib.load(model_path)
    model = model_data['model']
    features_list = model_data['features']
    model_version = model_data.get('model_version', '1.0.0')

    # Conectarse a PostgreSQL
    db_user = os.getenv("PGUSER", "postgres")
    db_host = os.getenv("PGHOST", "localhost")
    db_pass = os.getenv("PGPASSWORD")
    db_name = os.getenv("PGDATABASE", "escandon_bi")
    db_port = os.getenv("PGPORT", "5432")

    print(f"[Predict] Conectando a PostgreSQL ({db_host}:{db_port}/{db_name})...")
    conn = psycopg2.connect(
        user=db_user,
        password=db_pass,
        host=db_host,
        database=db_name,
        port=db_port
    )

    # Leer la foto actual
    query = """
        SELECT 
            itemcode,
            itemdescription,
            stock_actual,
            consumo_7d,
            consumo_15d,
            consumo_30d,
            consumo_promedio_diario,
            variabilidad_consumo,
            minstock,
            maxstock,
            pedidos_abiertos,
            dias_stock_restante,
            riesgo_base,
            fecha_ultimo_movimiento,
            fecha_desabasto
        FROM ml_dataset_reorden_sku
    """
    
    print("[Predict] Leyendo dataset analítico actual...")
    df = pd.read_sql(query, conn)

    if df.empty:
        print("❌ Error: No hay datos en ml_dataset_reorden_sku para predecir.")
        conn.close()
        return

    print(f"[Predict] Leídos {len(df)} registros para predicción.")

    # Preprocesamiento
    risk_map = {'CRITICO': 3, 'ALTO': 2, 'MEDIO': 1, 'BAJO': 0}
    df['riesgo_base_enc'] = df['riesgo_base'].map(risk_map).fillna(0)

    
    for col in features_list:
        df[col] = pd.to_numeric(df[col], errors='coerce').fillna(0)

    # Hacer inferencia
    X = df[features_list]
    print("[Predict] Ejecutando modelo predictivo...")
    
    
    probabilities = model.predict_proba(X)[:, 1]
    df['prob_desabasto_7d'] = probabilities

    
    mask_ya_desabasto = df['stock_actual'] <= 0
    df.loc[mask_ya_desabasto, 'prob_desabasto_7d'] = 1.0

    
    def get_risk_ml(row):
        if row['stock_actual'] <= 0:
            return 'YA EN DESABASTO'
        prob = row['prob_desabasto_7d']
        if prob >= 0.80:
            return 'CRITICO'
        elif prob >= 0.60:
            return 'ALTO'
        elif prob >= 0.35:
            return 'MEDIO'
        else:
            return 'BAJO'

    df['riesgo_ml'] = df.apply(get_risk_ml, axis=1)
    df['modelo_version'] = model_version

    # Fecha estimada de agotamiento: hoy + días de stock restante
    
    def calc_fecha_agotamiento(row):
        if float(row.get('stock_actual') or 0) <= 0:
            return None
        dias = float(row.get('dias_stock_restante') or 0)
        if dias >= 9999:
            return None
        return date.today() + timedelta(days=math.ceil(dias))

    df['fecha_estimada_agotamiento'] = df.apply(calc_fecha_agotamiento, axis=1)

    # Persistir predicciones en PostgreSQL con transacción y limpieza
    print("[Predict] Guardando predicciones en PostgreSQL...")
    cursor = conn.cursor()
    try:
        
        cursor.execute("TRUNCATE TABLE ml_predictions_reorden_sku")
        
        insert_query = """
            INSERT INTO ml_predictions_reorden_sku (
                itemcode, itemdescription, stock_actual, consumo_promedio_diario, 
                dias_stock_restante, riesgo_base, prob_desabasto_7d, riesgo_ml, 
                modelo_version, fecha_ultimo_movimiento, fecha_desabasto,
                fecha_estimada_agotamiento, fecha_prediccion
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, CURRENT_TIMESTAMP)
        """
        
        records_to_insert = []
        for _, row in df.iterrows():
            
            fecha_ult = row.get('fecha_ultimo_movimiento')
            if pd.isna(fecha_ult):
                fecha_ult = None
            
            fecha_desab = row.get('fecha_desabasto')
            if pd.isna(fecha_desab):
                fecha_desab = None
            
            fecha_agot = row.get('fecha_estimada_agotamiento')
            if pd.isna(fecha_agot):
                fecha_agot = None
            records_to_insert.append((
                row['itemcode'],
                row['itemdescription'],
                float(row['stock_actual']),
                float(row['consumo_promedio_diario']),
                float(row['dias_stock_restante']),
                row['riesgo_base'],
                float(row['prob_desabasto_7d']),
                row['riesgo_ml'],
                row['modelo_version'],
                fecha_ult,
                fecha_desab,
                fecha_agot
            ))
            
        cursor.executemany(insert_query, records_to_insert)
        conn.commit()
        print(f"[SUCCESS] [Predict] Inserción exitosa de {len(records_to_insert)} predicciones en ml_predictions_reorden_sku.")
    except Exception as e:
        conn.rollback()
        print("[ERROR] Error al guardar predicciones:", e)
        raise e
    finally:
        cursor.close()
        conn.close()

if __name__ == "__main__":
    main()
