import os
import sys
import json
import shutil
import pandas as pd
import numpy as np
from sqlalchemy import create_engine, text
from dotenv import load_dotenv
from sklearn.ensemble import RandomForestRegressor, GradientBoostingRegressor, ExtraTreesRegressor
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
    print("=== Iniciando Entrenamiento de Modelo Predictivo de Ingresos (Multi-Model Tuning) ===")
    
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
    
    # Ordenar cronológicamente por serie (area, servicio, periodo_mes)
    df = df.sort_values(by=['area', 'servicio', 'periodo_mes']).reset_index(drop=True)
    
    # Feature Engineering de Rezago (Lag-1 Histórico Real)
    df['year'] = df['periodo_mes'].apply(lambda x: int(x.split('-')[0]))
    df['month'] = df['periodo_mes'].apply(lambda x: int(x.split('-')[1]))
    
    # Construir variables históricas del mes anterior (Lag-1) por cada área y servicio
    df['num_cuentas_mes_anterior'] = df.groupby(['area', 'servicio'])['num_cuentas'].shift(1)
    df['ticket_promedio_mes_anterior'] = df.groupby(['area', 'servicio'])['ticket_promedio'].shift(1)
    df['crecimiento_mensual_anterior'] = df.groupby(['area', 'servicio'])['crecimiento_mensual'].shift(1).fillna(0)
    
    # Label encoding básico para area y servicio
    df['area_encoded'] = df['area'].astype('category').cat.codes
    df['servicio_encoded'] = df['servicio'].astype('category').cat.codes
    
    features = [
        'area_encoded', 
        'servicio_encoded',
        'month',
        'ingresos_mes_anterior',
        'num_cuentas_mes_anterior',
        'ticket_promedio_mes_anterior',
        'crecimiento_mensual_anterior'
    ]
    
    target = 'ingresos_total'
    
    # Eliminar NaNs generados por los shifts
    df = df.dropna(subset=features + [target])
    
    if len(df) < 5:
        print("⚠️ [Warning] Muy pocos datos para entrenar el modelo.")
    
    X = df[features]
    y = df[target]
    
    # Split cronológico out-of-sample: el último mes registrado queda como test
    last_month = df['periodo_mes'].max()
    test_mask = df['periodo_mes'] == last_month
    train_df = df[~test_mask]
    test_df = df[test_mask]

    # Pool de candidatos a evaluar con regularización para evitar sobreajuste
    candidates = {
        'GradientBoostingRegressor': GradientBoostingRegressor(n_estimators=150, learning_rate=0.03, max_depth=4, min_samples_leaf=2, subsample=0.85, random_state=42),
        'RandomForestRegressor': RandomForestRegressor(n_estimators=200, max_depth=8, min_samples_leaf=2, random_state=42),
        'ExtraTreesRegressor': ExtraTreesRegressor(n_estimators=200, max_depth=8, min_samples_leaf=2, random_state=42)
    }

    best_name = 'GradientBoostingRegressor'
    best_candidate_model = candidates['GradientBoostingRegressor']
    best_score = float('inf') # Menor MAE out-of-sample
    eval_metrics = {}

    print(f"\n--- Evaluando {len(candidates)} Modelos Candidatos (Test: {last_month}) ---")
    if len(train_df) >= 3 and len(test_df) >= 1:
        for name, cand in candidates.items():
            cand.fit(train_df[features], train_df[target])
            y_pred_cand = cand.predict(test_df[features])
            
            mae_cand = mean_absolute_error(test_df[target], y_pred_cand)
            rmse_cand = np.sqrt(mean_squared_error(test_df[target], y_pred_cand))
            r2_cand = r2_score(test_df[target], y_pred_cand)
            
            eval_metrics[name] = {'mae': mae_cand, 'rmse': rmse_cand, 'r2': r2_cand}
            print(f"  -> {name:<26} | Out-of-Sample MAE: ${mae_cand:,.2f} | RMSE: ${rmse_cand:,.2f} | R2: {r2_cand:.4f}")
            
            if mae_cand < best_score:
                best_score = mae_cand
                best_name = name
                best_candidate_model = cand
    else:
        print("[Warning] Historial insuficiente para split cronologico; usando GradientBoostingRegressor por defecto.")

    print(f"\n[BEST MODEL] Mejor Modelo Seleccionado: {best_name} (Mejor desempeno en validacion out-of-sample)")

    best_val_metrics = eval_metrics.get(best_name, {'mae': 0, 'rmse': 0, 'r2': 0})

    # Entrenar el modelo final seleccionado con TODO el historial disponible
    final_model = candidates[best_name]
    final_model.fit(X, y)
    
    y_pred_full = final_model.predict(X)
    full_mae = mean_absolute_error(y, y_pred_full)
    full_rmse = np.sqrt(mean_squared_error(y, y_pred_full))
    full_r2 = r2_score(y, y_pred_full)
    
    print(f"\n--- Desempeno Real de Generalizacion (Out-of-Sample / Test: {last_month}) ---")
    print(f"MAE:  ${best_val_metrics['mae']:,.2f}")
    print(f"RMSE: ${best_val_metrics['rmse']:,.2f}")
    print(f"R2:   {best_val_metrics['r2']:.4f}")

    print("\n--- Diagnostico Interno de Ajuste (Dataset Completo de Entrenamiento) ---")
    print(f"Train MAE:  ${full_mae:,.2f}")
    print(f"Train RMSE: ${full_rmse:,.2f}")
    print(f"Train R2:   {full_r2:.4f}")

    # Guardado seguro con Backup
    models_dir = os.path.join(os.path.dirname(__file__), 'models')
    reports_dir = os.path.join(os.path.dirname(__file__), 'reports')
    os.makedirs(models_dir, exist_ok=True)
    os.makedirs(reports_dir, exist_ok=True)
    
    model_path = os.path.join(models_dir, 'revenue_forecast_model.joblib')
    backup_path = os.path.join(models_dir, 'revenue_forecast_model_backup.joblib')
    
    if os.path.exists(model_path):
        try:
            shutil.copy2(model_path, backup_path)
            print(f"[Backup] Respaldo de modelo previo creado en {backup_path}")
        except Exception as e:
            print(f"[Backup Warning] No se pudo crear backup previo: {e}")

    joblib.dump(final_model, model_path)
    
    # Guardar categorías para el predictor
    categories_path = os.path.join(models_dir, 'revenue_forecast_categories.joblib')
    categories = {
        'area': dict(enumerate(df['area'].astype('category').cat.categories)),
        'servicio': dict(enumerate(df['servicio'].astype('category').cat.categories))
    }
    joblib.dump(categories, categories_path)
    
    print(f"[Success] Modelo activo guardado en {model_path}")
    print(f"[Success] Categorias guardadas en {categories_path}")

    # Guardar reporte en JSON con clara diferenciación de métricas
    metrics_report = {
        'model_name': best_name,
        'model_version': '1.1.0',
        'training_date': pd.Timestamp.now().isoformat(),
        'evaluation_mode': f'Out-of-Sample Holdout Validation (Mes: {last_month})',
        'train_samples': len(train_df),
        'test_samples': len(test_df),
        'features': features,
        'performance_out_of_sample': {
            'mae': round(float(best_val_metrics['mae']), 2),
            'rmse': round(float(best_val_metrics['rmse']), 2),
            'r2': round(float(best_val_metrics['r2']), 4),
            'note': 'Metrica principal de desempeno predictivo real para toma de decisiones'
        },
        'training_set_fit_diagnostics': {
            'train_mae': round(float(full_mae), 2),
            'train_rmse': round(float(full_rmse), 2),
            'train_r2': round(float(full_r2), 4),
            'note': 'Metrica interna de ajuste sobre datos de entrenamiento (no representa error fuera de muestra)'
        },
        'candidate_evaluations': eval_metrics
    }
    report_path = os.path.join(reports_dir, 'revenue_forecast_metrics.json')
    with open(report_path, 'w', encoding='utf-8') as f:
        json.dump(metrics_report, f, indent=2, ensure_ascii=False)
    print(f"[Success] Reporte de metricas guardado en {report_path}")

    # Registrar corrida en PostgreSQL ml_model_runs con métricas de validación out-of-sample
    try:
        with engine.connect() as conn:
            insert_run = text("""
                INSERT INTO ml_model_runs (
                    modelo_version, model_type, fecha_entrenamiento, train_rows, test_rows,
                    mae, rmse, r2, notas
                ) VALUES (
                    :version, 'REGRESSION', CURRENT_TIMESTAMP, :train_rows, :test_rows,
                    :mae, :rmse, :r2, :notas
                )
            """)
            conn.execute(insert_run, {
                "version": f"{best_name} v1.1.0",
                "train_rows": len(train_df),
                "test_rows": len(test_df),
                "mae": float(best_val_metrics['mae']),
                "rmse": float(best_val_metrics['rmse']),
                "r2": float(best_val_metrics['r2']),
                "notas": f"Metricas Out-of-Sample (mes {last_month}). Ajuste train R2={full_r2:.4f}"
            })
            conn.commit()
            print(f"[Success] Corrida registrada en ml_model_runs (Modelo: {best_name}, Test MAE: ${best_val_metrics['mae']:,.2f}, Test R2: {best_val_metrics['r2']:.4f})")
    except Exception as e:
        print(f"[Warning] No se pudo registrar corrida en ml_model_runs: {e}")

if __name__ == '__main__':
    main()

