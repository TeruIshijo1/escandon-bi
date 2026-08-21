import os
import json
import shutil
import psycopg2
import pandas as pd
import numpy as np
from dotenv import load_dotenv
from sklearn.model_selection import train_test_split
from sklearn.linear_model import LogisticRegression
from sklearn.ensemble import RandomForestClassifier, GradientBoostingClassifier, ExtraTreesClassifier
from sklearn.metrics import accuracy_score, precision_score, recall_score, f1_score, roc_auc_score, confusion_matrix
import joblib

def main():
    print("=== Iniciando Entrenamiento del Modelo de Riesgo (Multi-Model Classifier) ===")

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

    if df.empty:
        print("❌ Error: No se encontraron registros maduros en ml_dataset_reorden_sku_history.")
        conn.close()
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

    # 4b. Validar que existan al menos dos clases para clasificación supervisada
    num_classes = df['target_desabasto_7d'].nunique()
    if num_classes < 2:
        single_class = df['target_desabasto_7d'].unique()[0] if len(df) > 0 else 'N/A'
        print(f"[Train Warning] El historial analitico contiene solo una clase ({single_class}) en target_desabasto_7d.")
        print("[Train] Se omite el entrenamiento de modelos de clasificación supervisada hasta contar con eventos de ambas clases.")
        
        # Guardar reporte de baseline
        reports_dir = os.path.join(base_dir, 'reports')
        os.makedirs(reports_dir, exist_ok=True)
        metrics_report = {
            'model_name': 'BASELINE_ONLY',
            'model_version': '1.0.0',
            'training_date': pd.Timestamp.now().isoformat(),
            'train_samples': len(df),
            'test_samples': 0,
            'features': numeric_cols,
            'performance': None,
            'notes': f'Entrenamiento omitido: dataset contiene una sola clase ({single_class}) en target_desabasto_7d.'
        }
        report_path = os.path.join(reports_dir, 'reorder_risk_metrics.json')
        with open(report_path, 'w', encoding='utf-8') as f:
            json.dump(metrics_report, f, indent=2, ensure_ascii=False)
        print(f"[Train] Reporte de estado guardado en {report_path}")

        try:
            run_cursor = conn.cursor()
            run_cursor.execute("""
                INSERT INTO ml_model_runs (
                    modelo_version, fecha_entrenamiento, train_rows, test_rows,
                    notas
                ) VALUES (%s, %s, %s, %s, %s)
            """, (
                'BASELINE_ONLY v1.0.0',
                pd.Timestamp.now(),
                len(df),
                0,
                f'Entrenamiento omitido: dataset con una sola clase ({single_class})'
            ))
            conn.commit()
            print("[Train] Corrida registrada en ml_model_runs.")
        except Exception as e:
            conn.rollback()
            print("[Train] Advertencia: no se pudo registrar en ml_model_runs:", e)
        finally:
            conn.close()
        return

    # 5. División Temporal (Train/Test)
    # Agrupar por fechas de snapshot únicas y dividir (80% train, 20% test)
    unique_dates = df['snapshot_date'].unique()
    unique_dates = sorted(unique_dates)
    
    use_temporal = False
    if len(unique_dates) >= 3:
        split_idx = int(len(unique_dates) * 0.8)
        train_dates = unique_dates[:split_idx]
        test_dates = unique_dates[split_idx:]
        
        cand_train = df[df['snapshot_date'].isin(train_dates)]
        cand_test = df[df['snapshot_date'].isin(test_dates)]
        
        # Validar que ambas particiones tengan al menos 1 muestra de cada clase si es posible
        if cand_train['target_desabasto_7d'].nunique() >= 2:
            train_df = cand_train
            test_df = cand_test
            use_temporal = True
            print(f"[Train] División temporal: Train en {len(train_dates)} fechas ({len(train_df)} filas), Test en {len(test_dates)} fechas ({len(test_df)} filas).")
    
    if not use_temporal:
        print("[Train] Aplicando división aleatoria estratificada (train/test split)...")
        train_df, test_df = train_test_split(
            df, test_size=0.2, stratify=df['target_desabasto_7d'], random_state=42
        )

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
        'RandomForestClassifier': RandomForestClassifier(class_weight='balanced', n_estimators=200, max_depth=10, random_state=42),
        'GradientBoostingClassifier': GradientBoostingClassifier(n_estimators=150, learning_rate=0.05, max_depth=4, random_state=42),
        'ExtraTreesClassifier': ExtraTreesClassifier(class_weight='balanced', n_estimators=200, max_depth=10, random_state=42),
        'LogisticRegression': LogisticRegression(class_weight='balanced', max_iter=2000, random_state=42)
    }

    # 6b. Baseline de reglas de negocio (riesgo_base >= ALTO predice desabasto)
    # Sirve para demostrar que el ML aporta valor sobre la regla actual
    baseline_pred_test = (test_df['riesgo_base'].isin(['CRITICO', 'ALTO'])).astype(int)
    baseline_acc = accuracy_score(y_test, baseline_pred_test)
    baseline_prec = precision_score(y_test, baseline_pred_test, zero_division=0)
    baseline_rec = recall_score(y_test, baseline_pred_test, zero_division=0)
    baseline_f1 = f1_score(y_test, baseline_pred_test, zero_division=0)
    baseline_cm = confusion_matrix(y_test, baseline_pred_test).tolist()
    print(f"[BASELINE] Reglas (riesgo_base CRITICO/ALTO) | Acc: {baseline_acc:.4f} | Prec: {baseline_prec:.4f} | Recall: {baseline_rec:.4f} | F1: {baseline_f1:.4f}")

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
            roc_auc_str = f"{roc_auc:.4f}"
        else:
            roc_auc = None
            roc_auc_str = "N/A"

        # Calcular métricas
        acc = accuracy_score(y_test, y_pred)
        prec = precision_score(y_test, y_pred, zero_division=0)
        rec = recall_score(y_test, y_pred, zero_division=0)
        f1 = f1_score(y_test, y_pred, zero_division=0)
        cm = confusion_matrix(y_test, y_pred).tolist()

        print(f"  -> {name} | Acc: {acc:.4f} | Prec: {prec:.4f} | Recall: {rec:.4f} | F1: {f1:.4f} | AUC: {roc_auc_str}")

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

    print(f"\n[BEST MODEL] Mejor Modelo Seleccionado: {best_model_name} (Recall clase 1: {best_recall:.4f}, F1: {best_metrics['f1_score']:.4f})")

    # 7. Guardar modelo y metadatos con backup seguro
    model_data = {
        'model': best_model,
        'features': numeric_cols,
        'model_name': best_model_name,
        'model_version': '1.1.0',
        'training_date': pd.Timestamp.now().isoformat(),
        'performance': best_metrics
    }
    model_path = os.path.join(models_dir, 'reorder_risk_7d.joblib')
    backup_path = os.path.join(models_dir, 'reorder_risk_7d_backup.joblib')
    
    if os.path.exists(model_path):
        try:
            shutil.copy2(model_path, backup_path)
            print(f"[Backup] Respaldo de modelo previo creado en {backup_path}")
        except Exception as e:
            print(f"[Backup Warning] No se pudo crear backup previo: {e}")

    joblib.dump(model_data, model_path)
    print(f"[Success] Modelo guardado en {model_path}")

    # 8. Guardar métricas de reporte
    metrics_report = {
        'model_name': best_model_name,
        'model_version': '1.1.0',
        'training_date': model_data['training_date'],
        'train_samples': len(train_df),
        'test_samples': len(test_df),
        'features': numeric_cols,
        'performance': best_metrics,
        'baseline': {
            'name': 'Reglas de negocio (riesgo_base CRITICO/ALTO)',
            'accuracy': baseline_acc,
            'precision': baseline_prec,
            'recall': baseline_rec,
            'f1_score': baseline_f1,
            'confusion_matrix': baseline_cm,
            'mejora_f1_vs_baseline': round(best_metrics['f1_score'] - baseline_f1, 4)
        }
    }
    report_path = os.path.join(reports_dir, 'reorder_risk_metrics.json')
    with open(report_path, 'w', encoding='utf-8') as f:
        json.dump(metrics_report, f, indent=2, ensure_ascii=False)
    print(f"[Success] Reporte de métricas guardado en {report_path}")

    # 9. Registrar corrida en ml_model_runs (historial de desempeño del modelo)
    try:
        run_cursor = conn.cursor()
        run_cursor.execute("""
            INSERT INTO ml_model_runs (
                modelo_version, model_type, fecha_entrenamiento, train_rows, test_rows,
                precision, recall, f1, roc_auc, baseline_f1, notas
            ) VALUES (%s, 'CLASSIFICATION', %s, %s, %s, %s, %s, %s, %s, %s, %s)
        """, (
            best_model_name + ' v' + model_data['model_version'],
            pd.Timestamp.now(),
            len(train_df),
            len(test_df),
            best_metrics['precision'],
            best_metrics['recall'],
            best_metrics['f1_score'],
            best_metrics['roc_auc'],
            baseline_f1,
            'Entrenamiento optimizado multi-modelo'
        ))
        conn.commit()
        print(f"[Success] Corrida registrada en ml_model_runs (modelo: {best_model_name}, F1: {best_metrics['f1_score']:.4f})")
    except Exception as e:
        conn.rollback()
        print("[Train] Advertencia: no se pudo registrar la corrida en ml_model_runs:", e)
    finally:
        conn.close()

if __name__ == "__main__":
    main()
