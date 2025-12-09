import React, { useEffect, useState } from "react";
import { ArrowRight, Users, Zap, BarChart3, Target, TrendingUp, Award } from "lucide-react";

interface LogicModel {
  id: string;
  programCode: string;
  programName: string;
  inputs: string[];
  activities: string[];
  outputs: string[];
  shortTermOutcomes: string[];
  midTermOutcomes: string[];
  longTermImpact: string[];
}

const LogicModelPage: React.FC = () => {
  const [model, setModel] = useState<LogicModel | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/logic-models/VIOLENCE_PREVENTION", { credentials: "include" })
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load logic model");
        return res.json();
      })
      .then((data) => {
        setModel(data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-gold text-xl" data-testid="loading-indicator">Loading...</div>
      </div>
    );
  }

  if (error || !model) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-red-500" data-testid="error-message">{error || "Logic model not found"}</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white p-6" data-testid="logic-model-page">
      <div className="max-w-7xl mx-auto">
        <h1 
          className="text-3xl font-bold text-center mb-2"
          style={{ color: "#d4af37" }}
          data-testid="page-title"
        >
          {model.programName}
        </h1>
        <p className="text-center text-gray-400 mb-8" data-testid="page-subtitle">
          Logic Model Framework
        </p>

        <div className="grid grid-cols-1 lg:grid-cols-6 gap-4">
          <ModelSection
            title="INPUTS"
            subtitle="Resources"
            items={model.inputs}
            icon={<Users size={24} />}
            color="#d4af37"
            testId="inputs-section"
          />
          
          <div className="hidden lg:flex items-center justify-center">
            <ArrowRight size={32} className="text-gray-600" />
          </div>

          <ModelSection
            title="ACTIVITIES"
            subtitle="What We Do"
            items={model.activities}
            icon={<Zap size={24} />}
            color="#60a5fa"
            testId="activities-section"
          />
          
          <div className="hidden lg:flex items-center justify-center">
            <ArrowRight size={32} className="text-gray-600" />
          </div>

          <ModelSection
            title="OUTPUTS"
            subtitle="Measurable Results"
            items={model.outputs}
            icon={<BarChart3 size={24} />}
            color="#34d399"
            testId="outputs-section"
          />
          
          <div className="hidden lg:block" />
        </div>

        <div className="mt-8 flex justify-center">
          <ArrowRight size={48} className="text-gray-600 rotate-90 lg:rotate-0" />
        </div>

        <h2 
          className="text-2xl font-bold text-center mt-6 mb-6"
          style={{ color: "#d4af37" }}
          data-testid="outcomes-heading"
        >
          OUTCOMES
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <OutcomeSection
            title="SHORT-TERM"
            timeframe="6–12 months"
            items={model.shortTermOutcomes}
            icon={<Target size={24} />}
            color="#f59e0b"
            testId="short-term-section"
          />
          
          <OutcomeSection
            title="MID-TERM"
            timeframe="1–3 years"
            items={model.midTermOutcomes}
            icon={<TrendingUp size={24} />}
            color="#8b5cf6"
            testId="mid-term-section"
          />
          
          <OutcomeSection
            title="LONG-TERM IMPACT"
            timeframe="3–5 years"
            items={model.longTermImpact}
            icon={<Award size={24} />}
            color="#ec4899"
            testId="long-term-section"
          />
        </div>
      </div>
    </div>
  );
};

interface ModelSectionProps {
  title: string;
  subtitle: string;
  items: string[];
  icon: React.ReactNode;
  color: string;
  testId: string;
}

const ModelSection: React.FC<ModelSectionProps> = ({ title, subtitle, items, icon, color, testId }) => (
  <div 
    className="bg-gray-900 rounded-lg p-4 border"
    style={{ borderColor: color }}
    data-testid={testId}
  >
    <div className="flex items-center gap-2 mb-3">
      <span style={{ color }}>{icon}</span>
      <div>
        <h3 className="font-bold text-lg" style={{ color }}>{title}</h3>
        <p className="text-xs text-gray-400">{subtitle}</p>
      </div>
    </div>
    <ul className="space-y-2">
      {items.map((item, idx) => (
        <li 
          key={idx} 
          className="text-sm text-gray-300 flex items-start gap-2"
          data-testid={`${testId}-item-${idx}`}
        >
          <span style={{ color }}>•</span>
          {item}
        </li>
      ))}
    </ul>
  </div>
);

interface OutcomeSectionProps {
  title: string;
  timeframe: string;
  items: string[];
  icon: React.ReactNode;
  color: string;
  testId: string;
}

const OutcomeSection: React.FC<OutcomeSectionProps> = ({ title, timeframe, items, icon, color, testId }) => (
  <div 
    className="bg-gray-900 rounded-lg p-5 border"
    style={{ borderColor: color }}
    data-testid={testId}
  >
    <div className="flex items-center gap-3 mb-4">
      <span style={{ color }}>{icon}</span>
      <div>
        <h3 className="font-bold text-lg" style={{ color }}>{title}</h3>
        <p className="text-xs text-gray-400">{timeframe}</p>
      </div>
    </div>
    <ul className="space-y-3">
      {items.map((item, idx) => (
        <li 
          key={idx} 
          className="text-sm text-gray-300 flex items-start gap-2"
          data-testid={`${testId}-item-${idx}`}
        >
          <span style={{ color }}>✓</span>
          {item}
        </li>
      ))}
    </ul>
  </div>
);

export default LogicModelPage;
