import os
import sys
import pandas as pd
import numpy as np
from sqlalchemy import create_engine, text
from dotenv import load_dotenv
import joblib
from datetime import datetime
from dateutil.relativedelta import relativedelta

def get_db_connection():
    load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env'))
    db_user = os.getenv('PGUSER', 'postgres')
    db_pass = os.getenv('PGPASSWORD')
    db_host = os.getenv('PGHOST', 'localhost')
    db_port = os.getenv('PGPORT', '5432')
    db_name = os.getenv('PGDATABASE', 'escandon_bi')
    return create_engine(f'postgresql://{db_user}:{db_pass}@{db_host}:{db_port}/{db_name}')

def main():
    print("=== Iniciando Predicción de Ingresos (Siguiente Mes) ===")
    
    engine = get_db_connection()
    models_dir = os.path.join(os.path.dirname(__file__), 'models')
    model_path = os.path.join(models_dir, 'revenue_forecast_model.joblib')
    categories_path = os.path.join(models_dir, 'revenue_forecast_categories.joblib')
    
    if not os.path.exists(model_path) or not os.path.exists(categories_path):
        print("[Error] No se encontró el modelo entrenado. Corre train_revenue_forecast.py primero.")
        return
        
    model = joblib.load(model_path)
    categories = joblib.load(categories_path)
    
    # Invertir el diccionario de categorías para búsqueda rápida
    area_mapping = {v: k for k, v in categories['area'].items()}
    servicio_mapping = {v: k for k, v in categories['servicio'].items()}
    
    # Obtener el último mes registrado en el dataset
    query_latest = """
        SELECT MAX(periodo_mes) as ultimo_mes FROM ml_dataset_ingresos_mensual
    """
    
    with engine.connect() as conn:
        res = conn.execute(text(query_latest)).fetchone()
        if not res or not res[0]:
            print("[Error] No hay datos en ml_dataset_ingresos_mensual.")
            return
        ultimo_mes_str = res[0]
        
    print(f"[Predict] Último mes con datos: {ultimo_mes_str}")
    
    # Obtener los datos del último mes para usarlos como "ingresos_mes_anterior" del siguiente
    query_data = f"""
        SELECT 
            area,
            servicio,
            ingresos_total as ingresos_mes_anterior,
            ticket_promedio,
            num_cuentas
        FROM ml_dataset_ingresos_mensual
        WHERE periodo_mes = '{ultimo_mes_str}'
    """
    
    df_actual = pd.read_sql(query_data, engine)
    
    if df_actual.empty:
        print("[Error] No hay registros para el mes base.")
        return
        
    # Calcular el siguiente mes (periodo_predicho)
    dt_ultimo = datetime.strptime(ultimo_mes_str, "%Y-%m")
    dt_siguiente = dt_ultimo + relativedelta(months=1)
    periodo_predicho = dt_siguiente.strftime("%Y-%m")
    mes_predicho_num = dt_siguiente.month
    
    print(f"[Predict] Proyectando para el periodo: {periodo_predicho}")
    
    df_pred = df_actual.copy()
    df_pred['month'] = mes_predicho_num
    
    # Codificar area y servicio según el modelo
    # Si un area/servicio es nuevo y no está en el training, lo mapearemos a -1, o lo ignoramos
    # En RandomForest puede fallar si mandamos -1 si no fue entrenado con -1, pero como no son one-hot sino ordinales, lo dejamos en -1
    df_pred['area_encoded'] = df_pred['area'].map(area_mapping).fillna(-1)
    df_pred['servicio_encoded'] = df_pred['servicio'].map(servicio_mapping).fillna(-1)
    
    features = [
        'area_encoded', 
        'servicio_encoded',
        'month',
        'ingresos_mes_anterior',
        'ticket_promedio',
        'num_cuentas'
    ]
    
    # Limpiar posibles NaNs
    df_pred[features] = df_pred[features].fillna(0)
    
    X = df_pred[features]
    
    # Realizar predicción
    predictions = model.predict(X)
    
    # En RandomForest podemos estimar un intervalo sencillo basado en los árboles
    preds_trees = np.array([tree.predict(X.values) for tree in model.estimators_])
    # preds_trees tiene shape (n_estimators, n_samples)
    
    intervalo_bajo = np.percentile(preds_trees, 5, axis=0)
    intervalo_alto = np.percentile(preds_trees, 95, axis=0)
    
    df_pred['periodo_predicho'] = periodo_predicho
    df_pred['ingreso_estimado'] = predictions
    df_pred['intervalo_bajo'] = intervalo_bajo
    df_pred['intervalo_alto'] = intervalo_alto
    df_pred['modelo_version'] = "RF-1.0"
    df_pred['metodo'] = "RandomForestRegressor"
    
    # Limpiar predicciones que den negativo
    df_pred['ingreso_estimado'] = df_pred['ingreso_estimado'].clip(lower=0)
    df_pred['intervalo_bajo'] = df_pred['intervalo_bajo'].clip(lower=0)
    df_pred['intervalo_alto'] = df_pred['intervalo_alto'].clip(lower=0)
    
    # Guardar en PostgreSQL
    print("[Predict] Guardando proyecciones en la base de datos...")
    
    with engine.connect() as conn:
        trans = conn.begin()
        try:
            # Borrar predicciones previas para ese mismo periodo si las hubiera
            conn.execute(text("DELETE FROM ml_forecast_ingresos_mensual WHERE periodo_predicho = :periodo"), {"periodo": periodo_predicho})
            
            insert_query = text("""
                INSERT INTO ml_forecast_ingresos_mensual (
                    periodo_predicho, area, servicio, ingreso_estimado, 
                    intervalo_bajo, intervalo_alto, modelo_version, metodo, fecha_prediccion
                ) VALUES (:periodo_predicho, :area, :servicio, :ingreso_estimado, 
                          :intervalo_bajo, :intervalo_alto, :modelo_version, :metodo, CURRENT_TIMESTAMP)
            """)
            
            records_to_insert = []
            for _, row in df_pred.iterrows():
                records_to_insert.append({
                    "periodo_predicho": row['periodo_predicho'],
                    "area": row['area'],
                    "servicio": row['servicio'],
                    "ingreso_estimado": float(row['ingreso_estimado']),
                    "intervalo_bajo": float(row['intervalo_bajo']),
                    "intervalo_alto": float(row['intervalo_alto']),
                    "modelo_version": row['modelo_version'],
                    "metodo": row['metodo']
                })
            
            conn.execute(insert_query, records_to_insert)
            trans.commit()
            print(f"[Success] {len(records_to_insert)} predicciones insertadas exitosamente.")
        except Exception as e:
            trans.rollback()
            print(f"[Error] Fallo al guardar en base de datos: {e}")
            raise e

if __name__ == '__main__':
    main()
