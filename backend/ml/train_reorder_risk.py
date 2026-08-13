import os
import json
import psycopg2
import pandas as pd
import numpy as np
from dotenv import load_dotenv
from sklearn.model_selection import train_test_split
from sklearn.linear_model import LogisticRegression
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score, precision_score, recall_score, f1_score, roc_auc_score, confusion_matrix
import joblib

def main():
    print("=== Iniciando Entrenamiento del Modelo de Riesgo ===")

    # 1. Cargar variables de entorno del archivo .env de backend
    base_dir = os.path.dirname(os.path.abspath(__file__))
    dotenv_path = os.path.join(base_dir, '..', '.env')
    load_dotenv(dotenv_path)

    # Crear carpetas de destino si no existen
    models_dir = os.path.join(base_dir, 'models')
    reports_dir = os.path.join(base_dir, 'reports')
    os.makedirs(models_dir, exist_ok=True)
    os.makedirs(reports_dir, exist_ok=True)

    # 2. Conectarse a PostgreSQL
    db_user = os.getenv("PGUSER", "postgres")
    db_host = os.getenv("PGHOST", "localhost")
    db_pass = os.getenv("PGPASSWORD")
    db_name = os.getenv("PGDATABASE", "escandon_bi")
    db_port = os.getenv("PGPORT", "5432")

    print(f"[Train] Conectando a PostgreSQL ({db_host}:{db_port}/{db_name})...")
    conn = psycopg2.connect(
        user=db_user,
        password=db_pass,
        host=db_host,
        database=db_name,
        port=db_port
    )

    # 3. Extraer historial maduro de la base de datos
    query = """
        SELECT 
            snapshot_date,
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
            target_desabasto_7d
        FROM ml_dataset_reorden_sku_history
        WHERE target_desabasto_7d IS NOT NULL
        ORDER BY snapshot_date ASC
    """
    
    print("[Train] Leyendo datos históricos desde PostgreSQL...")
    df = pd.read_sql(query, conn)
    conn.close()

    if df.empty:
        print("❌ Error: No se encontraron registros maduros en ml_dataset_reorden_sku_history.")
        return

    print(f"[Train] Cargados {len(df)} registros para entrenamiento.")

    # 4. Preprocesamiento de Datos
    # Mapeo de riesgo_base a variables numéricas
    risk_map = {'CRITICO': 3, 'ALTO': 2, 'MEDIO': 1, 'BAJO': 0}
    df['riesgo_base_enc'] = df['riesgo_base'].map(risk_map).fillna(0)

    # Convertir todas las columnas requeridas a numéricas y llenar nulos
    numeric_cols = [
        'stock_actual', 'consumo_7d', 'consumo_15d', 'consumo_30d',
        'consumo_promedio_diario', 'variabilidad_consumo', 'minstock',
        'maxstock', 'pedidos_abiertos', 'dias_stock_restante', 'riesgo_base_enc'
    ]
    
    for col in numeric_cols:
        df[col] = pd.to_numeric(df[col], errors='coerce').fillna(0)

    df['target_desabasto_7d'] = pd.to_numeric(df['target_desabasto_7d'], errors='coerce').astype(int)

    # 5. División Temporal (Train/Test)
    # Agrupar por fechas de snapshot únicas y dividir (80% train, 20% test)
    unique_dates = df['snapshot_date'].unique()
    unique_dates = sorted(unique_dates)
    
    if len(unique_dates) < 3:
        print("[Train] Pocas fechas en el historial. Haciendo división aleatoria estratificada...")
        train_df, test_df = train_test_split(
            df, test_size=0.2, stratify=df['target_desabasto_7d'], random_state=42
        )
    else:
        split_idx = int(len(unique_dates) * 0.8)
        train_dates = unique_dates[:split_idx]
        test_dates = unique_dates[split_idx:]
        
        train_df = df[df['snapshot_date'].isin(train_dates)]
        test_df = df[df['snapshot_date'].isin(test_dates)]
        
        print(f"[Train] División temporal: Train en {len(train_dates)} fechas ({len(train_df)} filas), Test en {len(test_dates)} fechas ({len(test_df)} filas).")

    # Features y target
    X_train = train_df[numeric_cols]
    y_train = train_df['target_desabasto_7d']
    X_test = test_df[numeric_cols]
    y_test = test_df['target_desabasto_7d']

    print(f"[Train] Clase positiva en Train: {y_train.sum()} de {len(y_train)} ({y_train.mean():.2%})")
    print(f"[Train] Clase positiva en Test: {y_test.sum()} de {len(y_test)} ({y_test.mean():.2%})")

    # 6. Entrenar Modelos
    # Usamos balanced class weights debido a la alta probabilidad de desbalance en la BD
    models = {
        'LogisticRegression': LogisticRegression(class_weight='balanced', max_iter=2000, random_state=42),
        'RandomForestClassifier': RandomForestClassifier(class_weight='balanced', n_estimators=100, random_state=42)
    }

    best_model_name = None
    best_model = None
    best_metrics = None
    best_recall = -1

    for name, model in models.items():
        print(f"[Train] Entrenando {name}...")
        model.fit(X_train, y_train)

        # Predecir
        y_pred = model.predict(X_test)
        # Manejar caso de que haya una sola clase en y_test para evitar fallas en roc_auc
        if len(np.unique(y_test)) > 1:
            y_prob = model.predict_proba(X_test)[:, 1]
            roc_auc = roc_auc_score(y_test, y_prob)
        else:
            roc_auc = 1.0

        # Calcular métricas
        acc = accuracy_score(y_test, y_pred)
        prec = precision_score(y_test, y_pred, zero_division=0)
        rec = recall_score(y_test, y_pred, zero_division=0)
        f1 = f1_score(y_test, y_pred, zero_division=0)
        cm = confusion_matrix(y_test, y_pred).tolist()

        print(f"  -> {name} | Acc: {acc:.4f} | Prec: {prec:.4f} | Recall: {rec:.4f} | F1: {f1:.4f} | AUC: {roc_auc:.4f}")

        # Priorizar Recall de la clase 1 (detectar desabasto es prioridad crítica de negocio)
        # En caso de empate en Recall, comparamos por F1-Score
        if (rec > best_recall) or (rec == best_recall and f1 > (best_metrics.get('f1_score', 0) if best_metrics else -1)):
            best_recall = rec
            best_model_name = name
            best_model = model
            best_metrics = {
                'accuracy': acc,
                'precision': prec,
                'recall': rec,
                'f1_score': f1,
                'roc_auc': roc_auc,
                'confusion_matrix': cm
            }

    print(f"[BEST MODEL] Mejor Modelo Seleccionado: {best_model_name} (Recall clase 1: {best_recall:.4f})")

    # 7. Guardar modelo y metadatos
    model_data = {
        'model': best_model,
        'features': numeric_cols,
        'model_name': best_model_name,
        'model_version': '1.0.0',
        'training_date': pd.Timestamp.now().isoformat()
    }
    model_path = os.path.join(models_dir, 'reorder_risk_7d.joblib')
    joblib.dump(model_data, model_path)
    print(f"[Train] Modelo guardado en {model_path}")

    # 8. Guardar métricas de reporte
    metrics_report = {
        'model_name': best_model_name,
        'model_version': '1.0.0',
        'training_date': model_data['training_date'],
        'train_samples': len(train_df),
        'test_samples': len(test_df),
        'features': numeric_cols,
        'performance': best_metrics
    }
    report_path = os.path.join(reports_dir, 'reorder_risk_metrics.json')
    with open(report_path, 'w', encoding='utf-8') as f:
        json.dump(metrics_report, f, indent=2, ensure_ascii=False)
    print(f"[Train] Reporte de métricas guardado en {report_path}")

if __name__ == "__main__":
    main()
