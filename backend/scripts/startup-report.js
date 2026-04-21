const startupStartedAt = Date.now();
const startupSteps = [];

function getStatusIcon(status) {
  switch (status) {
    case 'READY':
    case 'CHECKED':
      return 'OK';
    case 'CHECK_WARN':
      return 'WARN';
    case 'FAILED':
      return 'ERR';
    case 'SKIPPED':
      return 'SKIP';
    default:
      return 'RUN';
  }
}

function isProfileContractStep(name = '') {
  return String(name).toLowerCase() === 'profile contract'.toLowerCase();
}

function formatStatusLine(status, stepName = '') {
  if (isProfileContractStep(stepName) && (status === 'READY' || status === 'CHECKED')) {
    return 'OK   PROFIL_OK';
  }

  if (isProfileContractStep(stepName) && status === 'FAILED') {
    return 'ERR  PROFIL_FAIL';
  }

  if (isProfileContractStep(stepName) && status === 'CHECK_WARN') {
    return 'WARN PROFIL_WARN';
  }

  const icon = getStatusIcon(status);
  return `${icon} ${String(status).toUpperCase().padEnd(7, ' ')}`;
}

function startStep(name) {
  return {
    name,
    startedAt: Date.now(),
    index: startupSteps.length + 1,
    status: 'PENDING',
  };
}

function normalizeRunOutput(runResult, resolveStatus) {
  const resolvedStatus = typeof resolveStatus === 'function' ? resolveStatus(runResult) : resolveStatus;

  if (
    runResult &&
    typeof runResult === 'object' &&
    !Array.isArray(runResult) &&
    (Object.prototype.hasOwnProperty.call(runResult, 'status') ||
      Object.prototype.hasOwnProperty.call(runResult, 'details'))
  ) {
    const status = typeof runResult.status === 'string'
      ? runResult.status
      : String(resolvedStatus || 'READY');
    const details = runResult.details == null
      ? ''
      : typeof runResult.details === 'string'
        ? runResult.details
        : String(runResult.details);
    return { status, details };
  }

  const details = runResult == null ? '' : String(runResult);
  return {
    status: String(resolvedStatus || 'READY'),
    details,
  };
}

function finalizeStep(step, status, details = '') {
  const durationMs = Date.now() - step.startedAt;
  step.status = status;
  step.details = details;
  step.durationMs = durationMs;
  startupSteps.push(step);

  const detailText = details ? ` - ${details}` : '';
  const statusText = formatStatusLine(status, step.name);
  console.log(
    `[${String(step.index).padStart(2, '0')}] [${statusText}] ${step.name} (${durationMs}ms)${detailText}`,
  );
}

async function withStartupStep(name, runFn, options = {}) {
  const step = startStep(name);
  const resolveStatus = options.successStatus || 'READY';

  try {
    const details = await runFn();
    const { status, details: finalDetails } = normalizeRunOutput(details, resolveStatus);
    finalizeStep(step, status, finalDetails);
    return details;
  } catch (error) {
    finalizeStep(step, 'FAILED', error?.message || String(error));
    throw error;
  }
}

function printStartupReport(title = 'Backend stack', error = null) {
  const totalMs = Date.now() - startupStartedAt;
  console.log(`\n=== ${title} startup report ===`);

  for (const step of startupSteps) {
    const duration = step.durationMs != null ? `${step.durationMs}ms` : 'n/a';
    const details = step.details ? ` - ${step.details}` : '';
    const statusText = formatStatusLine(step.status, step.name);
    console.log(
      `[${String(step.index).padStart(2, '0')}] [${statusText}] ${step.name} (${duration})${details}`,
    );
  }

  if (error) {
    console.error(`[ERR] ${title} startup failed after ${totalMs}ms`);
    return false;
  }

  console.log(`[OK] ${title} startup completed in ${totalMs}ms`);
  return true;
}

module.exports = {
  withStartupStep,
  printStartupReport,
};