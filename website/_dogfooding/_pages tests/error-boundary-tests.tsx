/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import React from 'react';
import Layout from '@theme/Layout';
import Interpolate from '@docusaurus/Interpolate';

import ErrorBoundaryTestButton from '@site/src/components/ErrorBoundaryTestButton';

export default function ErrorBoundaryTests(): JSX.Element {
  return (
    <>
      <ErrorBoundaryTestButton>Crash outside layout</ErrorBoundaryTestButton>
      <Layout>
        <main className="container margin-vert--xl">
          <h1>Error boundary tests</h1>
          <div>
            <ErrorBoundaryTestButton>
              Crash inside layout
            </ErrorBoundaryTestButton>
          </div>
          <Interpolate values={{foo: <span>FooFoo</span>, bar: <b>BarBar</b>}}>
            {'{foo} is {bar}'}
          </Interpolate>
        </main>
      </Layout>
    </>
  );
}
