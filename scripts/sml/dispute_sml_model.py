"""
DISPUTE SML (Supervised Machine Learning) MODEL
================================================

This model learns from jury decisions to:
1. Predict likely verdicts for new cases
2. Suggest verdicts to judges (speed up process)
3. Flag anomalous voting patterns
4. Eventually auto-resolve high-confidence cases

TRAINING DATA FROM ON-CHAIN:
- SmlTrainingRecord accounts
- Job category, dispute category, amount tier
- Evidence quality, response times, prior disputes
- Jury votes and final verdict

MODEL OUTPUT:
- Predicted verdict (1-5)
- Confidence score (0-100)
- Reasoning (feature importance)
"""

import json
import numpy as np
from dataclasses import dataclass
from typing import List, Tuple, Dict, Optional
from enum import IntEnum
import pickle
import os

# ============================================================================
# ENUMS (match on-chain)
# ============================================================================

class DisputeCategory(IntEnum):
    NON_DELIVERY = 0
    QUALITY_ISSUE = 1
    NOT_AS_DESCRIBED = 2
    LATE_DELIVERY = 3
    COMMUNICATION_ISSUE = 4
    MALICIOUS_CONTENT = 5
    PAYMENT_DISPUTE = 6
    OTHER = 7

class JuryVerdict(IntEnum):
    PENDING = 0
    PARTY_A_WINS = 1
    PARTY_B_WINS = 2
    SPLIT = 3
    PARTIAL_A = 4
    PARTIAL_B = 5

# ============================================================================
# TRAINING DATA STRUCTURE
# ============================================================================

@dataclass
class SmlTrainingData:
    """Mirrors on-chain SmlTrainingRecord"""
    case_id: str
    job_category: int
    dispute_category: int
    amount_tier: int  # 0-4
    evidence_quality_a: int  # 0-100
    evidence_quality_b: int  # 0-100
    response_time_a: int  # hours
    response_time_b: int  # hours
    prior_disputes_a: int
    prior_disputes_b: int
    votes: List[bool]  # 10 votes, True=A, False=B
    confidences: List[int]  # 10 confidence scores
    final_verdict: int
    auto_resolved: bool
    consensus_strength: int  # 0-100

    def to_feature_vector(self) -> np.ndarray:
        """Convert to ML feature vector"""
        features = [
            self.job_category / 100.0,  # Normalize
            self.dispute_category / 7.0,
            self.amount_tier / 4.0,
            self.evidence_quality_a / 100.0,
            self.evidence_quality_b / 100.0,
            min(self.response_time_a, 168) / 168.0,  # Cap at 1 week
            min(self.response_time_b, 168) / 168.0,
            min(self.prior_disputes_a, 10) / 10.0,
            min(self.prior_disputes_b, 10) / 10.0,
            # Evidence difference (key feature!)
            (self.evidence_quality_a - self.evidence_quality_b) / 100.0,
            # Response time ratio
            (self.response_time_b - self.response_time_a) / 168.0 if self.response_time_a + self.response_time_b > 0 else 0,
            # Prior dispute ratio
            (self.prior_disputes_b - self.prior_disputes_a) / 10.0,
        ]
        return np.array(features, dtype=np.float32)

    def to_label(self) -> int:
        """Convert verdict to classification label"""
        return self.final_verdict

# ============================================================================
# SIMPLE GRADIENT BOOSTING MODEL (No external deps for portability)
# ============================================================================

class DecisionStump:
    """Simple decision stump for gradient boosting"""
    def __init__(self):
        self.feature_idx = 0
        self.threshold = 0.0
        self.left_value = 0.0
        self.right_value = 0.0

    def fit(self, X: np.ndarray, residuals: np.ndarray, sample_weight: np.ndarray = None):
        """Find best split"""
        n_samples, n_features = X.shape
        best_gain = -np.inf
        
        for feat_idx in range(n_features):
            feature_values = X[:, feat_idx]
            thresholds = np.unique(feature_values)
            
            for thresh in thresholds:
                left_mask = feature_values <= thresh
                right_mask = ~left_mask
                
                if left_mask.sum() < 2 or right_mask.sum() < 2:
                    continue
                
                left_mean = residuals[left_mask].mean()
                right_mean = residuals[right_mask].mean()
                
                # Calculate gain
                pred = np.where(left_mask, left_mean, right_mean)
                gain = -np.sum((residuals - pred) ** 2)
                
                if gain > best_gain:
                    best_gain = gain
                    self.feature_idx = feat_idx
                    self.threshold = thresh
                    self.left_value = left_mean
                    self.right_value = right_mean

    def predict(self, X: np.ndarray) -> np.ndarray:
        """Predict values"""
        feature_values = X[:, self.feature_idx]
        return np.where(feature_values <= self.threshold, self.left_value, self.right_value)

class SimpleGradientBoosting:
    """Simple gradient boosting classifier"""
    def __init__(self, n_estimators: int = 50, learning_rate: float = 0.1, n_classes: int = 6):
        self.n_estimators = n_estimators
        self.learning_rate = learning_rate
        self.n_classes = n_classes
        self.estimators: List[List[DecisionStump]] = []
        self.initial_predictions: np.ndarray = None

    def fit(self, X: np.ndarray, y: np.ndarray):
        """Train the model"""
        n_samples = X.shape[0]
        
        # One-hot encode labels
        y_onehot = np.zeros((n_samples, self.n_classes))
        for i, label in enumerate(y):
            if 0 <= label < self.n_classes:
                y_onehot[i, label] = 1
        
        # Initial predictions (class priors)
        self.initial_predictions = y_onehot.mean(axis=0)
        predictions = np.tile(self.initial_predictions, (n_samples, 1))
        
        # Boosting iterations
        for _ in range(self.n_estimators):
            round_estimators = []
            for c in range(self.n_classes):
                # Calculate residuals
                residuals = y_onehot[:, c] - self._softmax(predictions)[:, c]
                
                # Fit stump to residuals
                stump = DecisionStump()
                stump.fit(X, residuals)
                round_estimators.append(stump)
                
                # Update predictions
                predictions[:, c] += self.learning_rate * stump.predict(X)
            
            self.estimators.append(round_estimators)

    def predict_proba(self, X: np.ndarray) -> np.ndarray:
        """Predict class probabilities"""
        n_samples = X.shape[0]
        predictions = np.tile(self.initial_predictions, (n_samples, 1))
        
        for round_estimators in self.estimators:
            for c, stump in enumerate(round_estimators):
                predictions[:, c] += self.learning_rate * stump.predict(X)
        
        return self._softmax(predictions)

    def predict(self, X: np.ndarray) -> np.ndarray:
        """Predict class labels"""
        proba = self.predict_proba(X)
        return np.argmax(proba, axis=1)

    def _softmax(self, x: np.ndarray) -> np.ndarray:
        """Softmax function"""
        exp_x = np.exp(x - np.max(x, axis=1, keepdims=True))
        return exp_x / np.sum(exp_x, axis=1, keepdims=True)

# ============================================================================
# SML MODEL WRAPPER
# ============================================================================

class DisputeSmlModel:
    """Main SML model for dispute prediction"""
    
    def __init__(self, model_path: str = "dispute_sml_model.pkl"):
        self.model_path = model_path
        self.model: Optional[SimpleGradientBoosting] = None
        self.version = 1
        self.training_samples = 0
        self.accuracy = 0.0
        self.feature_names = [
            "job_category", "dispute_category", "amount_tier",
            "evidence_quality_a", "evidence_quality_b",
            "response_time_a", "response_time_b",
            "prior_disputes_a", "prior_disputes_b",
            "evidence_diff", "response_diff", "dispute_diff"
        ]

    def train(self, training_data: List[SmlTrainingData], test_split: float = 0.2) -> Dict:
        """Train the model on historical dispute data"""
        if len(training_data) < 10:
            return {"error": "Need at least 10 training samples"}
        
        # Prepare data
        X = np.array([d.to_feature_vector() for d in training_data])
        y = np.array([d.to_label() for d in training_data])
        
        # Filter out invalid labels
        valid_mask = (y >= 0) & (y < 6)
        X = X[valid_mask]
        y = y[valid_mask]
        
        if len(X) < 10:
            return {"error": "Not enough valid samples after filtering"}
        
        # Train/test split
        n_test = int(len(X) * test_split)
        indices = np.random.permutation(len(X))
        test_idx = indices[:n_test]
        train_idx = indices[n_test:]
        
        X_train, X_test = X[train_idx], X[test_idx]
        y_train, y_test = y[train_idx], y[test_idx]
        
        # Train model
        self.model = SimpleGradientBoosting(n_estimators=50, learning_rate=0.1)
        self.model.fit(X_train, y_train)
        
        # Evaluate
        y_pred = self.model.predict(X_test)
        self.accuracy = (y_pred == y_test).mean()
        self.training_samples = len(X_train)
        self.version += 1
        
        # Save model
        self.save()
        
        return {
            "version": self.version,
            "training_samples": self.training_samples,
            "test_samples": len(X_test),
            "accuracy": round(self.accuracy * 100, 2),
            "status": "success"
        }

    def predict(self, case_data: SmlTrainingData) -> Dict:
        """Predict verdict for a new case"""
        if self.model is None:
            self.load()
        
        if self.model is None:
            return {
                "verdict": JuryVerdict.PENDING,
                "confidence": 0,
                "reasoning": "Model not trained yet"
            }
        
        X = case_data.to_feature_vector().reshape(1, -1)
        proba = self.model.predict_proba(X)[0]
        predicted_class = int(np.argmax(proba))
        confidence = int(proba[predicted_class] * 100)
        
        # Generate reasoning based on feature importance
        reasoning = self._generate_reasoning(case_data, predicted_class)
        
        return {
            "verdict": JuryVerdict(predicted_class),
            "verdict_name": JuryVerdict(predicted_class).name,
            "confidence": confidence,
            "probabilities": {
                JuryVerdict(i).name: round(p * 100, 1) 
                for i, p in enumerate(proba)
            },
            "reasoning": reasoning,
            "model_version": self.version,
            "model_accuracy": round(self.accuracy * 100, 1)
        }

    def _generate_reasoning(self, case: SmlTrainingData, predicted: int) -> str:
        """Generate human-readable reasoning"""
        reasons = []
        
        # Evidence quality
        if case.evidence_quality_a > case.evidence_quality_b + 20:
            reasons.append("Party A has stronger evidence")
        elif case.evidence_quality_b > case.evidence_quality_a + 20:
            reasons.append("Party B has stronger evidence")
        
        # Response times
        if case.response_time_a < case.response_time_b / 2:
            reasons.append("Party A responded more quickly")
        elif case.response_time_b < case.response_time_a / 2:
            reasons.append("Party B responded more quickly")
        
        # Prior disputes
        if case.prior_disputes_a > case.prior_disputes_b + 2:
            reasons.append("Party A has more prior disputes (negative signal)")
        elif case.prior_disputes_b > case.prior_disputes_a + 2:
            reasons.append("Party B has more prior disputes (negative signal)")
        
        # Dispute category context
        if case.dispute_category == DisputeCategory.NON_DELIVERY:
            reasons.append("Non-delivery cases typically favor claimant if evidence is clear")
        elif case.dispute_category == DisputeCategory.QUALITY_ISSUE:
            reasons.append("Quality disputes often result in partial resolutions")
        
        if not reasons:
            reasons.append("Case features are balanced; prediction based on similar historical cases")
        
        return "; ".join(reasons)

    def save(self):
        """Save model to disk"""
        data = {
            "model": self.model,
            "version": self.version,
            "training_samples": self.training_samples,
            "accuracy": self.accuracy
        }
        with open(self.model_path, 'wb') as f:
            pickle.dump(data, f)

    def load(self):
        """Load model from disk"""
        if os.path.exists(self.model_path):
            with open(self.model_path, 'rb') as f:
                data = pickle.load(f)
                self.model = data["model"]
                self.version = data["version"]
                self.training_samples = data["training_samples"]
                self.accuracy = data["accuracy"]

# ============================================================================
# ORACLE INTERFACE (for on-chain integration)
# ============================================================================

class SmlOracle:
    """
    Oracle interface for on-chain integration.
    
    Options for on-chain integration:
    1. Switchboard Oracle - Push predictions on-chain
    2. Pyth-style feed - Publish model predictions
    3. Off-chain API - Query via HTTP, verify with signature
    """
    
    def __init__(self, model: DisputeSmlModel):
        self.model = model
    
    def get_prediction_for_case(self, case_json: str) -> str:
        """Get prediction in JSON format for oracle submission"""
        case_data = json.loads(case_json)
        
        training_data = SmlTrainingData(
            case_id=case_data.get("case_id", ""),
            job_category=case_data.get("job_category", 0),
            dispute_category=case_data.get("dispute_category", 0),
            amount_tier=case_data.get("amount_tier", 0),
            evidence_quality_a=case_data.get("evidence_quality_a", 50),
            evidence_quality_b=case_data.get("evidence_quality_b", 50),
            response_time_a=case_data.get("response_time_a", 24),
            response_time_b=case_data.get("response_time_b", 24),
            prior_disputes_a=case_data.get("prior_disputes_a", 0),
            prior_disputes_b=case_data.get("prior_disputes_b", 0),
            votes=[],
            confidences=[],
            final_verdict=0,
            auto_resolved=False,
            consensus_strength=0
        )
        
        prediction = self.model.predict(training_data)
        
        return json.dumps({
            "case_id": case_data.get("case_id"),
            "predicted_verdict": prediction["verdict"],
            "confidence": prediction["confidence"],
            "model_version": prediction["model_version"],
            "timestamp": int(__import__('time').time())
        })

# ============================================================================
# DEMO / TESTING
# ============================================================================

def generate_synthetic_training_data(n_samples: int = 100) -> List[SmlTrainingData]:
    """Generate synthetic training data for testing"""
    data = []
    
    for i in range(n_samples):
        # Simulate realistic patterns
        evidence_a = np.random.randint(20, 100)
        evidence_b = np.random.randint(20, 100)
        
        # Verdict correlates with evidence quality
        if evidence_a > evidence_b + 30:
            verdict = JuryVerdict.PARTY_A_WINS
        elif evidence_b > evidence_a + 30:
            verdict = JuryVerdict.PARTY_B_WINS
        elif abs(evidence_a - evidence_b) < 10:
            verdict = np.random.choice([JuryVerdict.SPLIT, JuryVerdict.PARTIAL_A, JuryVerdict.PARTIAL_B])
        else:
            verdict = np.random.choice([JuryVerdict.PARTY_A_WINS, JuryVerdict.PARTY_B_WINS, JuryVerdict.SPLIT])
        
        data.append(SmlTrainingData(
            case_id=f"case_{i}",
            job_category=np.random.randint(0, 20),
            dispute_category=np.random.randint(0, 8),
            amount_tier=np.random.randint(0, 5),
            evidence_quality_a=evidence_a,
            evidence_quality_b=evidence_b,
            response_time_a=np.random.randint(1, 72),
            response_time_b=np.random.randint(1, 72),
            prior_disputes_a=np.random.randint(0, 5),
            prior_disputes_b=np.random.randint(0, 5),
            votes=[np.random.choice([True, False]) for _ in range(10)],
            confidences=[np.random.randint(50, 100) for _ in range(10)],
            final_verdict=int(verdict),
            auto_resolved=np.random.random() > 0.3,
            consensus_strength=np.random.randint(60, 100)
        ))
    
    return data

if __name__ == "__main__":
    print("=" * 60)
    print("DISPUTE SML MODEL - TRAINING & TESTING")
    print("=" * 60)
    
    # Generate synthetic data
    print("\n📊 Generating synthetic training data...")
    training_data = generate_synthetic_training_data(500)
    print(f"   Generated {len(training_data)} training samples")
    
    # Train model
    print("\n🧠 Training SML model...")
    model = DisputeSmlModel("dispute_sml_model.pkl")
    result = model.train(training_data)
    print(f"   Training result: {json.dumps(result, indent=2)}")
    
    # Test prediction
    print("\n🔮 Testing prediction...")
    test_case = SmlTrainingData(
        case_id="test_001",
        job_category=5,
        dispute_category=DisputeCategory.QUALITY_ISSUE,
        amount_tier=2,
        evidence_quality_a=85,  # Strong evidence for A
        evidence_quality_b=40,  # Weak evidence for B
        response_time_a=6,      # Quick response
        response_time_b=48,     # Slow response
        prior_disputes_a=0,
        prior_disputes_b=3,     # B has history
        votes=[],
        confidences=[],
        final_verdict=0,
        auto_resolved=False,
        consensus_strength=0
    )
    
    prediction = model.predict(test_case)
    print(f"   Prediction: {json.dumps(prediction, indent=2)}")
    
    print("\n✅ SML Model ready!")
    print(f"   Model version: {model.version}")
    print(f"   Accuracy: {model.accuracy * 100:.1f}%")
    print(f"   Training samples: {model.training_samples}")

