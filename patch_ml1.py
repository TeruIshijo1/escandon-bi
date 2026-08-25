import re
with open('backend/ml/train_reorder_risk.py', 'r', encoding='utf-8') as f:
    code = f.read()

# Add HistGradientBoosting to imports
code = code.replace("from sklearn.ensemble import RandomForestClassifier, GradientBoostingClassifier, ExtraTreesClassifier", 
"from sklearn.ensemble import RandomForestClassifier, GradientBoostingClassifier, ExtraTreesClassifier, HistGradientBoostingClassifier\nfrom sklearn.model_selection import RandomizedSearchCV")

# Replace the models block
old_models = """    models = {
        'RandomForestClassifier': RandomForestClassifier(class_weight='balanced', n_estimators=200, max_depth=10, random_state=42),
        'GradientBoostingClassifier': GradientBoostingClassifier(n_estimators=150, learning_rate=0.05, max_depth=4, random_state=42),
        'ExtraTreesClassifier': ExtraTreesClassifier(class_weight='balanced', n_estimators=200, max_depth=10, random_state=42),
        'LogisticRegression': LogisticRegression(class_weight='balanced', max_iter=2000, random_state=42)
    }"""

new_models = """    # Hyperparameter search configurations
    print("[Train] Iniciando Optimizacion de Hiperparametros (AutoML)...")
    models = {
        'HistGradientBoosting': {
            'estimator': HistGradientBoostingClassifier(random_state=42),
            'params': {
                'learning_rate': [0.01, 0.05, 0.1],
                'max_iter': [100, 200, 300],
                'max_depth': [None, 5, 10],
                'l2_regularization': [0.0, 0.1, 1.0]
            }
        },
        'RandomForestClassifier': {
            'estimator': RandomForestClassifier(class_weight='balanced', random_state=42),
            'params': {
                'n_estimators': [100, 200, 300],
                'max_depth': [10, 20, None],
                'min_samples_leaf': [1, 2, 4]
            }
        },
        'GradientBoostingClassifier': {
            'estimator': GradientBoostingClassifier(random_state=42),
            'params': {
                'n_estimators': [100, 200],
                'learning_rate': [0.05, 0.1],
                'max_depth': [3, 5, 7]
            }
        }
    }
    
    # Train and Tune
    tuned_models = {}
    for name, config in models.items():
        print(f"  -> Tuneando {name}...")
        search = RandomizedSearchCV(config['estimator'], config['params'], n_iter=5, cv=3, scoring='recall', n_jobs=-1, random_state=42)
        search.fit(X_train, y_train)
        tuned_models[name] = search.best_estimator_
        print(f"     Mejores parametros: {search.best_params_}")
    models = tuned_models"""

code = code.replace(old_models, new_models)

with open('backend/ml/train_reorder_risk.py', 'w', encoding='utf-8') as f:
    f.write(code)
print("Patched train_reorder_risk.py")
