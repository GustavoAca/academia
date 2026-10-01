import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { state, store } from '../js/core/estado.js';
import {
  rotinaPadrao,
  vigenteDe,
  rotinaNaData,
  mesmaConteudo,
  congelarVersao,
  estenderParaHoje,
  prepararParaSalvar,
  definirHistorico
} from '../js/rotina-service.js';
import {
  catalogoEm,
  defsAtuais,
  idsAtuais,
  rotinaSelecionada,
  limparCatalogoPassado
} from '../js/core/programa.js';

/** Minimal custom routine with one Monday exercise per name. */
function rotinaCustom(inicio, nomes) {
  const dias = { seg: false, ter: false, qua: false, qui: false, sex: false, sab: false, dom: false };
  dias.seg = nomes.length > 0;
  return {
    origem: 'personalizada',
    nome: 'Teste',
    inicio,
    duracao: { tipo: 'semanas', valor: 16, ate: '' },
    dias,
    treinos: {
      seg: {
        t: 'A',
        ex: nomes.map(n => ({ nome: n, grupo: 'Peito', series: 3, min: 8, max: 12 }))
      }
    },
    criadaEm: '2026-09-01T00:00:00.000Z',
    atualizadaEm: '2026-09-01T00:00:00.000Z'
  };
}

const snapshot = () => ({
  rotina: store.rotina,
  catalogo: store.catalogo,
  exerciseIdPorNome: store.exerciseIdPorNome,
  workoutsPorDia: store.workoutsPorDia,
  d: state.d,
  s: state.s
});
const original = snapshot();

beforeEach(() => {
  definirHistorico([]);
  limparCatalogoPassado();
});

afterEach(() => {
  definirHistorico([]);
  limparCatalogoPassado();
  Object.assign(store, original);
  state.d = original.d;
  state.s = original.s;
});

test('vigenteDe usa vigenteDesde e cai para o início', () => {
  assert.equal(vigenteDe({ inicio: '2026-09-14', vigenteDesde: '2026-10-05' }), '2026-10-05');
  assert.equal(vigenteDe({ inicio: '2026-09-14' }), '2026-09-14');
  assert.equal(vigenteDe(null), '2026-09-14');
});

test('rotinaNaData devolve a ativa no presente e a versão congelada no passado', () => {
  const atual = rotinaCustom('2026-09-14', ['Supino novo']);
  atual.vigenteDesde = '2026-10-01';
  const velha = rotinaCustom('2026-09-14', ['Supino antigo']);
  const hist = [{ ate: '2026-09-30', rotina: velha }];

  assert.equal(rotinaNaData('2026-10-01', atual, hist), atual, 'vigência começa hoje');
  assert.equal(rotinaNaData('2026-12-31', atual, hist), atual, 'futuro usa a ativa');
  assert.equal(rotinaNaData('2026-09-30', atual, hist), velha, 'último dia da versão antiga');
  assert.equal(rotinaNaData('2026-09-14', atual, hist), velha);
  assert.equal(rotinaNaData('2026-01-01', atual, hist), velha, 'datas antes de tudo caem na mais antiga');
});

test('rotinaNaData sem histórico devolve a rotina ativa', () => {
  const atual = rotinaPadrao();
  assert.equal(rotinaNaData('2020-01-01', atual, []), atual);
  assert.equal(rotinaNaData('2020-01-01', atual, null), atual);
  assert.equal(rotinaNaData('2020-01-01', null, []), null);
});

test('mesmaConteudo ignora timestamps e vigência', () => {
  const a = rotinaCustom('2026-09-14', ['Supino']);
  const b = JSON.parse(JSON.stringify(a));
  b.atualizadaEm = '2026-10-05T12:00:00.000Z';
  b.vigenteDesde = '2026-10-05';
  assert.equal(mesmaConteudo(a, b), true);

  b.dias.seg = false;
  assert.equal(mesmaConteudo(a, b), false, 'conteúdo diferente não é igual');
});

test('congelarVersao guarda a rotina anterior até ontem (cópia profunda)', () => {
  const antes = rotinaCustom('2026-09-14', ['Antigo']);
  antes.vigenteDesde = '2026-09-14';

  const hist = congelarVersao(antes, [], '2026-10-05');
  assert.equal(hist.length, 1);
  assert.equal(hist[0].ate, '2026-10-04');
  assert.equal(hist[0].rotina.treinos.seg.ex[0].nome, 'Antigo');

  hist[0].rotina.treinos.seg.ex[0].nome = 'mutado';
  assert.equal(antes.treinos.seg.ex[0].nome, 'Antigo', 'não mexe na rotina original');
});

test('congelarVersao ignora quem nunca esteve no passado', () => {
  const base = [{ ate: '2026-10-04', rotina: rotinaCustom('2026-09-14', ['Y']) }];

  const hoje = rotinaCustom('2026-09-14', ['X']);
  hoje.vigenteDesde = '2026-10-05';
  assert.equal(congelarVersao(hoje, base, '2026-10-05'), base, 'vigência é hoje');

  const futuro = rotinaCustom('2026-11-02', ['X']);
  assert.equal(congelarVersao(futuro, base, '2026-10-05'), base, 'vigência é futura');

  assert.equal(congelarVersao(null, base, '2026-10-05'), base, 'sem rotina anterior');
});

test('congelarVersao mantém as versões antigas em ordem sem mutar a lista', () => {
  const hist = [{ ate: '2026-08-31', rotina: rotinaCustom('2026-07-01', ['A']) }];
  const antes = rotinaCustom('2026-09-01', ['B']);
  antes.vigenteDesde = '2026-09-01';

  const out = congelarVersao(antes, hist, '2026-10-05');
  assert.notEqual(out, hist);
  assert.equal(hist.length, 1, 'a lista de entrada não é alterada');
  assert.deepEqual(out.map(h => h.ate), ['2026-08-31', '2026-10-04']);
});

test('estenderParaHoje cobre hoje quando a duração terminou', () => {
  const r = rotinaCustom('2026-09-14', ['X']);
  r.duracao = { tipo: 'semanas', valor: 1, ate: '' };
  estenderParaHoje(r, '2026-10-05');
  assert.equal(r.duracao.tipo, 'semanas');
  assert.equal(r.duracao.valor, 4, '22 dias de programa pedem 4 semanas');
});

test('estenderParaHoje não mexe em duração que já cobre hoje', () => {
  const r = rotinaCustom('2026-09-14', ['X']);
  estenderParaHoje(r, '2026-10-05');
  assert.equal(r.duracao.valor, 16);

  const futuro = rotinaCustom('2099-01-01', ['X']);
  estenderParaHoje(futuro, '2026-10-05');
  assert.equal(futuro.duracao.valor, 16);
});

test('estenderParaHoje arruma meses e data final', () => {
  const meses = rotinaCustom('2026-09-14', ['X']);
  meses.duracao = { tipo: 'meses', valor: 1, ate: '' };
  estenderParaHoje(meses, '2026-10-20');
  assert.equal(meses.duracao.tipo, 'meses');
  assert.ok(meses.duracao.valor >= 2);

  const ate = rotinaCustom('2026-09-14', ['X']);
  ate.duracao = { tipo: 'ate', valor: 1, ate: '2026-09-20' };
  estenderParaHoje(ate, '2026-10-05');
  assert.equal(ate.duracao.ate, '2026-10-05');
});

test('prepararParaSalvar trava o início quando há histórico', () => {
  const anterior = rotinaCustom('2026-09-14', ['Antigo']);
  anterior.vigenteDesde = '2026-09-14';
  const hist = [{ ate: '2026-10-04', rotina: anterior }];

  const r = rotinaCustom('2026-11-02', ['Novo']);
  const { r: out, travou } = prepararParaSalvar(r, anterior, '2026-10-05', hist);
  assert.equal(travou, true);
  assert.equal(out.inicio, '2026-09-14', 'semana 1 não anda para frente');
});

test('prepararParaSalvar permite antecipar o início', () => {
  const anterior = rotinaCustom('2026-09-14', ['Antigo']);
  anterior.vigenteDesde = '2026-09-14';
  const hist = [{ ate: '2026-10-04', rotina: anterior }];

  const r = rotinaCustom('2026-08-31', ['Novo']);
  const { r: out, travou } = prepararParaSalvar(r, anterior, '2026-10-05', hist);
  assert.equal(travou, false);
  assert.equal(out.inicio, '2026-08-31');
});

test('prepararParaSalvar não trava a primeira rotina', () => {
  const r = rotinaCustom('2026-11-02', ['Novo']);
  const { r: out, travou } = prepararParaSalvar(r, null, '2026-10-05', []);
  assert.equal(travou, false);
  assert.equal(out.inicio, '2026-11-02');
});

test('prepararParaSalvar não trava quem começou hoje (sem histórico)', () => {
  const anterior = rotinaCustom('2026-10-05', ['A']);
  anterior.vigenteDesde = '2026-10-05';

  const r = rotinaCustom('2026-11-02', ['Novo']);
  const { r: out, travou } = prepararParaSalvar(r, anterior, '2026-10-05', []);
  assert.equal(travou, false);
  assert.equal(out.inicio, '2026-11-02');
});

test('catálogo por data: dia passado usa a versão congelada, hoje a ativa', () => {
  const velha = rotinaCustom('2026-09-14', ['Supino antigo']);
  const atual = rotinaCustom('2026-09-14', ['Supino novo']);
  atual.vigenteDesde = '2026-10-01';

  store.rotina = atual;
  store.catalogo = { seg: { workout: { id: 1 }, ids: [7], defs: [['Supino novo', 'Peito', 3, 8, 12]] } };
  store.exerciseIdPorNome = new Map([['Supino antigo', 42], ['Supino novo', 7]]);
  store.workoutsPorDia = new Map([['seg', { id: 9, diaSemana: 'seg' }]]);
  definirHistorico([{ ate: '2026-09-30', rotina: velha }]);

  const passado = catalogoEm(0, 1); // 14/09/2026: antes da nova versão
  assert.deepEqual(passado.defs, [['Supino antigo', 'Peito', 3, 8, 12]]);
  assert.deepEqual(passado.ids, [42]);
  assert.equal(passado.workout.id, 9);

  const presente = catalogoEm(0, 5); // 12/10/2026: na vigência da nova
  assert.deepEqual(presente.defs, [['Supino novo', 'Peito', 3, 8, 12]]);
  assert.deepEqual(presente.ids, [7]);
  assert.equal(presente.workout.id, 1);

  state.s = 1;
  state.d = 0;
  assert.equal(rotinaSelecionada(), velha, 'seleção da semana 1 cai na versão antiga');
  assert.deepEqual(defsAtuais(), passado.defs);
  assert.deepEqual(idsAtuais(), [42]);
});

test('catálogo por data sem histórico devolve sempre o catálogo ativo', () => {
  store.rotina = rotinaCustom('2026-09-14', ['Supino novo']);
  store.catalogo = { seg: { workout: { id: 1 }, ids: [7], defs: [['Supino novo', 'Peito', 3, 8, 12]] } };
  store.exerciseIdPorNome = new Map([['Supino novo', 7]]);
  store.workoutsPorDia = new Map([['seg', { id: 1, diaSemana: 'seg' }]]);

  assert.equal(catalogoEm(0, 1), store.catalogo.seg);
  state.s = 1;
  state.d = 0;
  assert.equal(rotinaSelecionada(), store.rotina);
});
