import csv
import json
from datetime import UTC, datetime
from pathlib import Path
from statistics import median

import joblib
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score, roc_auc_score
from sklearn.model_selection import train_test_split

ROOT = Path(__file__).resolve().parent.parent
DATASET_PATH = ROOT / 'data' / 'diabetes_cleaned.csv'
MODEL_DIR = ROOT / 'models'
MODEL_DIR.mkdir(parents=True, exist_ok=True)
JSON_MODEL_PATH = MODEL_DIR / 'diabetes-random-forest.json'
JOBLIB_MODEL_PATH = MODEL_DIR / 'diabetes-random-forest.joblib'
REPORT_PATH = MODEL_DIR / 'training-report.json'

FEATURE_NAMES = ['Glucose', 'BloodPressure', 'BMI', 'Age', 'Daily_Steps']
TARGET_NAME = 'Outcome'

with DATASET_PATH.open(newline='', encoding='utf-8') as f:
    reader = csv.DictReader(f)
    rows = list(reader)

medians = {
    name: float(median(float(row[name]) for row in rows if row[name] != ''))
    for name in FEATURE_NAMES
}

X = []
y = []
for row in rows:
    X.append([float(row[name]) if row[name] != '' else medians[name] for name in FEATURE_NAMES])
    y.append(int(row[TARGET_NAME]))

X_train, X_test, y_train, y_test = train_test_split(
    X,
    y,
    test_size=0.2,
    random_state=42,
    stratify=y,
)

model = RandomForestClassifier(
    n_estimators=120,
    max_depth=6,
    min_samples_leaf=4,
    random_state=42,
)
model.fit(X_train, y_train)

proba = model.predict_proba(X_test)[:, 1]
pred = model.predict(X_test)


def convert_tree(estimator):
    tree = estimator.tree_
    values = []
    for node_values in tree.value:
        class_counts = node_values[0]
        total = float(sum(class_counts)) or 1.0
        values.append([float(class_counts[0] / total), float(class_counts[1] / total)])
    return {
        'childrenLeft': tree.children_left.tolist(),
        'childrenRight': tree.children_right.tolist(),
        'features': tree.feature.tolist(),
        'thresholds': tree.threshold.tolist(),
        'values': values,
    }

artifact = {
    'modelType': 'random_forest_classifier',
    'trainedAt': datetime.now(UTC).isoformat().replace('+00:00', 'Z'),
    'dataset': str(DATASET_PATH),
    'featureNames': FEATURE_NAMES,
    'targetName': TARGET_NAME,
    'defaultFeatureValues': medians,
    'nEstimators': len(model.estimators_),
    'featureImportances': {
        name: float(value) for name, value in zip(FEATURE_NAMES, model.feature_importances_)
    },
    'trees': [convert_tree(estimator) for estimator in model.estimators_],
}

report = {
    'accuracy': float(accuracy_score(y_test, pred)),
    'rocAuc': float(roc_auc_score(y_test, proba)),
    'trainRows': len(X_train),
    'testRows': len(X_test),
    'features': FEATURE_NAMES,
    'defaultFeatureValues': medians,
    'featureImportances': artifact['featureImportances'],
}

JSON_MODEL_PATH.write_text(json.dumps(artifact, indent=2), encoding='utf-8')
REPORT_PATH.write_text(json.dumps(report, indent=2), encoding='utf-8')
joblib.dump(
    {
        'model': model,
        'feature_names': FEATURE_NAMES,
        'default_feature_values': medians,
        'training_report': report,
        'trained_at': artifact['trainedAt'],
        'dataset': str(DATASET_PATH),
    },
    JOBLIB_MODEL_PATH,
)

print(json.dumps(report, indent=2))
print(f'joblib_model={JOBLIB_MODEL_PATH}')
