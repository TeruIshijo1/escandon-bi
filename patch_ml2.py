import re
with open('backend/ml/train_revenue_forecast.py', 'r', encoding='utf-8') as f:
    code = f.read()

# Add HistGradientBoosting to imports
code = code.replace("from sklearn.ensemble import RandomForestRegressor, GradientBoostingRegressor, ExtraTreesRegressor", 
"from sklearn.ensemble import RandomForestRegressor, GradientBoostingRegressor, ExtraTreesRegressor, HistGradientBoostingRegressor\nfrom sklearn.model_selection import RandomizedSearchCV")

old_models = """    candidates = {
        'GradientBoostingRegressor': GradientBoostingRegressor(n_estimators=150, learning_rate=0.03, max_depth=4, min_samples_leaf=2, subsample=0.85, random_state=42),
        'RandomForestRegressor': RandomForestRegressor(n_estimators=200, max_depth=8, min_samples_leaf=2, random_state=42),
        'ExtraTreesRegressor': ExtraTreesRegressor(n_estimators=200, max_depth=8, min_samples_leaf=2, random_state=42)
    }"""

new_models = """    print("[Train] Iniciando Optimizacion de Hiperparametros (AutoML)...")
    candidates_config = {
        'HistGradientBoostingRegressor': {
            'estimator': HistGradientBoostingRegressor(random_state=42),
            'params': {
                'learning_rate': [0.01, 0.05, 0.1],
                'max_iter': [100, 200, 300],
                'max_depth': [None, 5, 10],
                'l2_regularization': [0.0, 0.1, 1.0]
            }
        },
        'RandomForestRegressor': {
            'estimator': RandomForestRegressor(random_state=42),
            'params': {
                'n_estimators': [100, 200, 300],
                'max_depth': [10, 20, None],
                'min_samples_leaf': [1, 2, 4]
            }
        },
        'GradientBoostingRegressor': {
            'estimator': GradientBoostingRegressor(random_state=42),
            'params': {
                'n_estimators': [100, 200],
                'learning_rate': [0.05, 0.1],
                'max_depth': [3, 5, 7]
            }
        }
    }
    
    candidates = {}
    for name, config in candidates_config.items():
        print(f"  -> Tuneando {name}...")
        search = RandomizedSearchCV(config['estimator'], config['params'], n_iter=5, cv=3, scoring='neg_mean_absolute_error', n_jobs=-1, random_state=42)
        search.fit(X, y)
        candidates[name] = search.best_estimator_
        print(f"     Mejores parametros: {search.best_params_}")"""

code = code.replace(old_models, new_models)

with open('backend/ml/train_revenue_forecast.py', 'w', encoding='utf-8') as f:
    f.write(code)
print("Patched train_revenue_forecast.py")
