export type AtomModelInput = {
  particle: 'electron' | 'muon';
  n: number;
  l: number;
  m: number;
};

const ELECTRON_SCALE = 1.0;
const MUON_SCALE = 0.005378;

export function describeAtomModel(input: AtomModelInput) {
  const { particle, n, l, m } = input;

  if (!Number.isInteger(n) || n < 1 || n > 6) {
    throw new Error('n must be an integer from 1 to 6 to match the current Atoms visualizer.');
  }
  if (!Number.isInteger(l) || l < 0 || l >= n) {
    throw new Error('l must be an integer with 0 <= l < n.');
  }
  if (!Number.isInteger(m) || m < -l || m > l) {
    throw new Error('m must be an integer with -l <= m <= l.');
  }

  const a0Scale = particle === 'muon' ? MUON_SCALE : ELECTRON_SCALE;
  const characteristicRadius = n * n * a0Scale;

  return {
    sourceRepo: 'mardukasoka/Atoms',
    sourceModel: 'web/index.html lightweight hydrogen-like approximation',
    particle,
    quantumNumbers: { n, l, m },
    relativeBohrScale: a0Scale,
    characteristicRadiusRelative: characteristicRadius,
    contractionRelativeToElectronicHydrogen:
      particle === 'muon' ? 1 / MUON_SCALE : 1,
    orbitalFamily:
      l === 0 ? 's' : l === 1 ? 'p' : l === 2 ? 'd-like' : 'higher-l fallback',
    epistemicStatus: 'visualization model',
    notes: [
      'This reproduces the current lightweight mobile visualizer semantics; it is not a high-precision bound-state solver.',
      'Rendering remains browser-side; this MCP tool exposes the model state only.'
    ]
  };
}
