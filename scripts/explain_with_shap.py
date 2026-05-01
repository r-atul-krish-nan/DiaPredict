import json
import sys
from pathlib import Path

import joblib
import numpy as np
import shap

ROOT = Path(__file__).resolve().parent.parent
MODEL_PATH = ROOT / 'models' / 'diabetes-random-forest.joblib'

FEATURE_LABELS = {
    'Glucose': 'Glucose',
    'BloodPressure': 'Blood Pressure',
    'BMI': 'BMI',
    'Age': 'Age',
    'Daily_Steps': 'Daily Steps',
}

bundle = joblib.load(MODEL_PATH)
model = bundle['model']
feature_names = bundle['feature_names']

payload = json.loads(sys.stdin.read())
values = payload['values']
observed_features = set(payload.get('observedFeatures', []))
vector = np.array([[float(values[name]) for name in feature_names]], dtype=float)

explainer = shap.TreeExplainer(model)
shap_values = explainer.shap_values(vector)
expected_value = explainer.expected_value
probability = float(model.predict_proba(vector)[0, 1])

if isinstance(shap_values, list):
    positive_class_values = np.asarray(shap_values[1])[0]
    base_value = expected_value[1] if isinstance(expected_value, (list, np.ndarray)) else expected_value
else:
    shap_array = np.asarray(shap_values)
    if shap_array.ndim == 3:
        positive_class_values = shap_array[0, :, 1]
        base_value = expected_value[1] if isinstance(expected_value, (list, np.ndarray)) else expected_value
    else:
        positive_class_values = shap_array[0]
        base_value = expected_value[0] if isinstance(expected_value, (list, np.ndarray)) else expected_value

contributions = []
for index, feature_name in enumerate(feature_names):
    shap_value = float(positive_class_values[index])
    contributions.append({
        'feature': feature_name,
        'label': FEATURE_LABELS.get(feature_name, feature_name),
        'featureValue': float(vector[0, index]),
        'shapValue': shap_value,
        'direction': 'increase' if shap_value >= 0 else 'decrease',
        'observedFromWatch': feature_name in observed_features,
    })

contributions.sort(key=lambda item: abs(item['shapValue']), reverse=True)

print(json.dumps({
    'probability': probability,
    'baseValue': float(base_value),
    'contributions': contributions,
}))
