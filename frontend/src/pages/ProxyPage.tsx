/**
 * Route component for the forward proxy's setup.
 */

import { useTranslation } from 'react-i18next'
import ProxySetup from '@/sections/project/proxy/ProxySetup'
import PageHeader from '@/components/page-header/PageHeader'

export default function ProxyPage() {
  const { t } = useTranslation('proxy')

  return (
    <>
      <PageHeader heading={t('title')} description={t('description')} links={[{ label: t('title') }]} />
      <ProxySetup />
    </>
  )
}
