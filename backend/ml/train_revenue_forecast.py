import os
import sys
import pandas as pd
import numpy as np
from sqlalchemy import create_engine
from dotenv import load_dotenv
from sklearn.ensemble import RandomForestRegressor
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
import joblib

def get_db_connection():
    load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env'))
    db_user = os.getenv('PGUSER', 'postgres')
    db_pass = os.getenv('PGPASSWORD')
    db_host = os.getenv('PGHOST', 'localhost')
    db_port = os.getenv('PGPORT', '5432')
    db_name = os.getenv('PGDATABASE', 'escandon_bi')
    return create_engine(f'postgresql://{db_user}:{db_pass}@{db_host}:{db_port}/{db_name}')

def main():
    print("=== Iniciando Entrenamiento de Modelo Predictivo de Ingresos ===")
    
    engine = get_db_connection()
    
    query = """
        SELECT 
            periodo_mes,
            area,
            servicio,
            ingresos_total,
            num_cuentas,
            ticket_promedio,
            ingresos_mes_anterior,
            crecimiento_mensual
        FROM ml_dataset_ingresos_mensual
        ORDER BY periodo_mes ASC
    """
    
    print("[Train] Extrayendo dataset analítico desde PostgreSQL...")
    df = pd.read_sql(query, engine)
    
    if df.empty:
        print("[Error] No hay datos en ml_dataset_ingresos_mensual. Abortando.")
        return
        
    print(f"[Train] Dataset cargado: {len(df)} registros.")
    
    # Feature Engineering
    # Convertir periodo_mes (YYYY-MM) a variables útiles
    df['year'] = df['periodo_mes'].apply(lambda x: int(x.split('-')[0]))
    df['month'] = df['periodo_mes'].apply(lambda x: int(x.split('-')[1]))
    
    # Label encoding básico para area y servicio
    df['area_encoded'] = df['area'].astype('category').cat.codes
    df['servicio_encoded'] = df['servicio'].astype('category').cat.codes
    
    features = [
        'area_encoded', 
        'servicio_encoded',
        'month',
        'ingresos_mes_anterior',
        'ticket_promedio',
        'num_cuentas'
    ]
    
    target = 'ingresos_total'
    
    # Eliminar NaNs
    df = df.dropna(subset=features + [target])
    
    if len(df) < 5:
        print("[Warning] Muy pocos datos para entrenar el modelo.")
        # Podemos usar un modelo muy simple o simplemente guardar el modelo de todos modos
    
    X = df[features]
    y = df[target]
    
    # Split cronológico: el último mes registrado queda como test (out-of-sample)
    # y el modelo se entrena con el resto del historial
    last_month = df['periodo_mes'].max()
    test_mask = df['periodo_mes'] == last_month
    train_df = df[~test_mask]
    test_df = df[test_mask]

    if len(train_df) >= 3 and len(test_df) >= 1:
        model_test = RandomForestRegressor(n_estimators=100, random_state=42)
        model_test.fit(train_df[features], train_df[target])
        y_pred_test = model_test.predict(test_df[features])

        test_mae = mean_absolute_error(test_df[target], y_pred_test)
        test_rmse = np.sqrt(mean_squared_error(test_df[target], y_pred_test))
        test_r2 = r2_score(test_df[target], y_pred_test)

        print("\n--- Evaluación Out-of-Sample (último mes como test) ---")
        print(f"Mes de prueba: {last_month} ({len(test_df)} registros)")
        print(f"MAE:  {test_mae:,.2f}")
        print(f"RMSE: {test_rmse:,.2f}")
        print(f"R2:   {test_r2:.4f}")
    else:
        print("[Warning] Historial insuficiente para split cronológico; se omite evaluación out-of-sample.")

    # Entrenar el modelo final con TODO el historial disponible
    model = RandomForestRegressor(n_estimators=100, random_state=42)
    model.fit(X, y)
    
    # Evaluar en el mismo set de entrenamiento (referencia interna)
    y_pred = model.predict(X)
    
    mae = mean_absolute_error(y, y_pred)
    rmse = np.sqrt(mean_squared_error(y, y_pred))
    r2 = r2_score(y, y_pred)
    
    print("\n--- Resultados del Entrenamiento (sobre el set completo) ---")
    print(f"MAE:  {mae:,.2f}")
    print(f"RMSE: {rmse:,.2f}")
    print(f"R2:   {r2:.4f}")
    
    # Guardar el modelo
    models_dir = os.path.join(os.path.dirname(__file__), 'models')
    os.makedirs(models_dir, exist_ok=True)
    
    model_path = os.path.join(models_dir, 'revenue_forecast_model.joblib')
    joblib.dump(model, model_path)
    
    # Guardar categorías para el predictor
    categories_path = os.path.join(models_dir, 'revenue_forecast_categories.joblib')
    categories = {
        'area': dict(enumerate(df['area'].astype('category').cat.categories)),
        'servicio': dict(enumerate(df['servicio'].astype('category').cat.categories))
    }
    joblib.dump(categories, categories_path)
    
    print(f"\n[Success] Modelo guardado en {model_path}")
    print(f"[Success] Categorías guardadas en {categories_path}")

if __name__ == '__main__':
    main()
