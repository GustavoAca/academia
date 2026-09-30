/**
 * Seed: make sure every exercise/workout referenced by PLANO exists in
 * IndexedDB. Runs on every startup and is idempotent.
 */

import { PLANO } from '../plano.js';
import { DIAS } from './utils.js';
import {
  saveExercise,
  saveWorkout,
  getAllExercises,
  getAllWorkouts
} from '../db.js';
import { initializeWorkoutExercisesFromPlano } from '../workout-service.js';

/** Unique exercise tuples [nome, grupo, series, min, max] of PLANO. */
export function extractExercisesFromPlano() {
  const exercises = [];
  const seen = new Set();

  for (const dia of Object.keys(PLANO)) {
    for (const ex of PLANO[dia].ex) {
      if (seen.has(ex[0])) continue;
      seen.add(ex[0]);
      exercises.push(ex);
    }
  }

  return exercises;
}

/**
 * Make sure every exercise/workout referenced by PLANO exists and that every
 * workout has its exercise links. Safe to call on every startup.
 * @returns {Promise<void>}
 */
export async function seedFromPlano() {
  const exercises = await getAllExercises();
  const names = new Set(exercises.map(e => e.nome));

  for (const ex of extractExercisesFromPlano()) {
    if (names.has(ex[0])) continue;
    await saveExercise({
      nome: ex[0],
      grupoMuscular: ex[1],
      descricao: '',
      videoUrl: '',
      ativo: true
    });
  }

  const workouts = await getAllWorkouts();
  const days = new Set(workouts.map(w => w.diaSemana));

  for (const dia of DIAS) {
    if (!PLANO[dia] || days.has(dia)) continue;
    await saveWorkout({
      nome: PLANO[dia].t,
      diaSemana: dia,
      ordem: 1,
      ativo: true
    });
  }

  await initializeWorkoutExercisesFromPlano(PLANO);
}
